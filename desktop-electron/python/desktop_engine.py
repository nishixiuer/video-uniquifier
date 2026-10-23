"""Desktop adapter. All video operations delegate to the existing Python core."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import uuid4

import yaml

from video_uniquifier import __version__
from video_uniquifier.core.models import Profile
from video_uniquifier.core.orchestrator import RunOptions, build_plan, run_full
from video_uniquifier.core.profile_loader import dump_profile, load_profile
from video_uniquifier.core.reels.config import ReelsRules, load_rules
from video_uniquifier.core.reels.native import default_profile_path, validate_native_profile
from video_uniquifier.core.reels.processor import inspect_source, prepare_plan, process_video
from video_uniquifier.core.reels.runtime import atomic_json, check_cancel, json_object
from video_uniquifier.core.runner import CancelToken, PauseToken, RunEvent

TERMINAL = {"success", "failed", "cancelled"}
KINDS = {"reels", "native", "qa", "calibrate", "corpus", "variants", "filequeue"}


def json_data(value: Any) -> Any:
    """Serialize Pydantic models/dataclasses without dropping zero or false values."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if dataclasses.is_dataclass(value):
        return json.loads(json.dumps(dataclasses.asdict(value), default=str))
    return value


class DesktopEngine:
    def __init__(self, root: Path, emit: Callable[[dict], None] | None = None) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.profile_root = self.root / "profiles"
        self.profile_root.mkdir(exist_ok=True)
        self.emit = emit or (lambda _job: None)
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="desktop")
        self.jobs: dict[str, dict] = {}
        self.tokens: dict[str, CancelToken] = {}
        self.pauses: dict[str, PauseToken] = {}
        self.futures: dict[str, Any] = {}
        self.closed = False
        self._last_progress: dict[str, float] = {}
        path = self.root / "jobs.json"
        if path.exists():
            for job in json_object(path).get("jobs", []):
                if job["status"] not in TERMINAL:
                    job.update(
                        status="failed",
                        stage="interrupted",
                        error="应用退出时任务尚未完成，可重试。",
                    )
                self.jobs[job["id"]] = job

    def _save(self) -> None:
        atomic_json(self.root / "jobs.json", {"jobs": list(self.jobs.values())[-1000:]})

    def _update(self, identifier: str, **changes: Any) -> None:
        with self.lock:
            now = time.monotonic()
            if set(changes) <= {"stage", "progress"}:
                if (
                    now - self._last_progress.get(identifier, 0) < 0.2
                    and changes.get("stage") == self.jobs[identifier]["stage"]
                ):
                    return
                self._last_progress[identifier] = now
            self.jobs[identifier].update(changes, updated_at=time.time())
            self._save()
            self.emit(dict(self.jobs[identifier]))

    def profiles(self) -> list[dict]:
        shipped = Path(str(files("video_uniquifier").joinpath("profiles")))
        result = []
        for path in [*sorted(shipped.glob("*.yaml")), *sorted(self.profile_root.glob("*.yaml"))]:
            profile = load_profile(path)
            result.append(
                {
                    "id": str(path),
                    "name": profile.name,
                    "custom": path.parent == self.profile_root,
                    "yaml": path.read_text(encoding="utf-8"),
                    "data": profile.model_dump(mode="json"),
                }
            )
        return result

    def _profile(self, name: str | None) -> Profile:
        available = self.profiles()
        chosen = next((p for p in available if p["id"] == name), None)
        if chosen is None:
            if name:
                raise ValueError("找不到选中的处理配置，请刷新配置列表。")
            chosen = next((p for p in available if p["name"] == "soft"), available[0])
        return Profile.model_validate(chosen["data"])

    def validate_yaml(self, text: str, kind: str) -> dict:
        if len(text.encode()) > 256 * 1024:
            raise ValueError("配置不能超过 256 KiB。")
        with TemporaryDirectory() as folder:
            path = Path(folder) / "rules.yaml"
            path.write_text(text, encoding="utf-8")
            model = load_rules(path) if kind == "reels" else load_profile(path)
            return model.model_dump(mode="json")

    def submit(self, params: dict) -> dict:
        if self.closed:
            raise ValueError("处理引擎正在退出。")
        kind = params.get("kind", "reels")
        if kind not in KINDS:
            raise ValueError("未知任务类型。")
        source = Path(params["source"]).resolve()
        if not (source.is_dir() if kind == "filequeue" else source.is_file()):
            raise ValueError("输入视频不存在，请重新选择。")
        params = {**params, "kind": kind, "source": str(source)}
        if kind == "reels":
            params["rules"] = ReelsRules.model_validate(params.get("rules", {})).model_dump(
                mode="json"
            )
        elif kind != "corpus":
            params["native_profile"] = self._profile(params.get("profile")).model_dump(mode="json")
        mode = params.get("mode", "export")
        if mode not in {"export", "sample", "preflight"}:
            raise ValueError("未知处理操作。")
        identifier = uuid4().hex
        record = {
            "id": identifier,
            "kind": kind,
            "mode": mode,
            "source": str(source),
            "name": source.name,
            "status": "queued",
            "progress": 0.0,
            "stage": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "params": params,
            "output": None,
            "report": None,
            "result": None,
            "error": None,
            "logs": [],
        }
        with self.lock:
            if sum(j["status"] not in TERMINAL for j in self.jobs.values()) >= 100:
                raise ValueError("队列已满，请等待现有任务完成。")
            self.jobs[identifier] = record
            self.tokens[identifier] = CancelToken()
            self.pauses[identifier] = PauseToken()
            self._save()
            self.futures[identifier] = self.pool.submit(self._run, identifier)
            self.emit(dict(record))
            return dict(record)

    def _run(self, identifier: str) -> None:
        job = self.jobs[identifier]
        token = self.tokens[identifier]
        try:
            check_cancel(token)
            self._update(identifier, status="running", stage="probing")
            params = job["params"]
            work = self.root / "work" / identifier
            work.mkdir(parents=True, exist_ok=True)
            if job["kind"] == "reels":
                result = self._reels(identifier, params, work)
            elif job["kind"] == "native":
                result = self._native(identifier, params, work)
            else:
                result = self._tool(identifier, params, work)
            if not result.get("output"):
                check_cancel(token)
            self._update(identifier, **result, status="success", progress=1.0, stage="success")
        except Exception as error:
            cancelled = token.is_cancelled()
            failure_report = self.root / "reels" / "failures" / f"{identifier}.json"
            self._update(
                identifier,
                status="cancelled" if cancelled else "failed",
                stage="cancelled" if cancelled else "failed",
                error=str(error),
                **({"report": str(failure_report)} if failure_report.exists() else {}),
            )

    def _reels(self, identifier: str, params: dict, work: Path) -> dict:
        rules = ReelsRules.model_validate(params["rules"])
        source = Path(params["source"])
        token = self.tokens[identifier]
        assets = work / "assets"
        assets.mkdir(exist_ok=True)
        for relative, original in params.get("assets", {}).items():
            if Path(relative).name != relative or relative in {".", ".."}:
                raise ValueError("素材文件名无效。")
            original = Path(original)
            if not original.is_file() or original.stat().st_size > 32 * 1024 * 1024:
                raise ValueError("Logo/字体必须是小于 32 MiB 的本地文件。")
            shutil.copyfile(original, assets / relative)
        if params.get("mode") == "preflight":
            from video_uniquifier.core.reels.packaging import render_layers

            meta = inspect_source(source, rules)
            _, findings = prepare_plan(
                meta, rules, validate_native_profile(default_profile_path()), work
            )
            duration = meta.duration_sec - rules.scenes.trim_start_sec - rules.scenes.trim_end_sec
            _, _, warnings = render_layers(rules, assets, work, duration, token)
            return {
                "result": {"source": json_data(meta), "findings": findings, "warnings": warnings}
            }
        if params.get("mode") == "sample":
            meta = inspect_source(source, rules)
            raw = rules.model_dump(mode="json")
            available = meta.duration_sec - rules.scenes.trim_start_sec - rules.scenes.trim_end_sec
            length = min(float(params.get("sample_duration", 10)), available)
            if length <= 0:
                raise ValueError("裁切后没有可用样片。")
            raw["scenes"]["trim_end_sec"] += available - length
            if raw["packaging"]["title"]["start_sec"] >= length:
                raw["packaging"]["title"]["enabled"] = False
            rules = ReelsRules.model_validate(raw)
        result = process_video(
            source,
            rules,
            self.root / "reels",
            job_id=identifier,
            asset_root=assets,
            cancel_token=token,
            on_status=lambda stage, fraction: self._update(
                identifier, stage=stage, progress=fraction
            ),
        )
        if params.get("output_dir"):
            result = self._export(result, Path(params["output_dir"]), identifier, source.stem)
        return {
            "output": str(result / "output.mp4"),
            "report": str(result / "report.json"),
            "result": {"directory": str(result), "source_offset": rules.scenes.trim_start_sec},
        }

    @staticmethod
    def _export(result: Path, destination: Path, identifier: str, stem: str) -> Path:
        """Publish a complete unique directory without overwriting another output."""
        destination.mkdir(parents=True, exist_ok=True)
        target = destination / f"{stem}-{identifier}"
        temporary = destination / f".{identifier}.exporting"
        if target.exists():
            raise FileExistsError(f"导出目录已存在：{target}")
        try:
            shutil.copytree(result, temporary)
            temporary.rename(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return target

    def _native(self, identifier: str, params: dict, work: Path) -> dict:
        from video_uniquifier.core.preflight import preflight

        source = Path(params["source"])
        profile = Profile.model_validate(params["native_profile"])
        encoder = params.get("encoder") or None
        token = self.tokens[identifier]
        plan = build_plan(source, profile, encoder)
        if params.get("mode") == "preflight":
            return {
                "result": {
                    "source": json_data(plan.source),
                    "findings": [json_data(f) for f in preflight(plan.source, plan, plan.encoder)],
                }
            }
        if params.get("mode") == "sample":
            from video_uniquifier.core._review_sample import _prepare_review_sample

            plan = _prepare_review_sample(
                source,
                profile,
                work / "sample",
                start_sec=float(params.get("sample_start", 0)),
                duration_sec=float(params.get("sample_duration", 10)),
                encoder=encoder,
                cancel_token=token,
            )
        destination = Path(params.get("output_dir") or self.root / "outputs")
        destination.mkdir(parents=True, exist_ok=True)
        variant = f"-{params['variant_index']}" if "variant_index" in params else ""
        output = destination / f"{source.stem}-{identifier}{variant}.{profile.output_container}"
        total_us = max(plan.source.duration_sec * 1_000_000, 1)
        segments: dict[int, int] = {}

        def event(ev: RunEvent) -> None:
            if ev.kind == "progress":
                segment = ev.payload.get("segment")
                if isinstance(segment, int):
                    with self.lock:
                        segments[segment] = int(str(ev.payload.get("out_time_us", 0)))
                        fraction = min(sum(segments.values()) / total_us, 1) * 0.8
                    self._update(
                        identifier,
                        progress=fraction,
                        stage=str(ev.payload.get("phase", "processing")),
                    )

        run_full(
            plan,
            RunOptions(
                work_dir=work,
                output=output,
                workers=int(params.get("workers", 1)),
                target_segment_sec=float(params.get("segment_sec", 600)),
                force_new_variant=bool(params.get("new_variant", False)),
            ),
            on_event=event,
            cancel_token=token,
            pause_token=self.pauses[identifier],
        )
        self._update(identifier, output=str(output), stage="quality:report")
        report_path = output.with_suffix(output.suffix + ".qa.json")
        self._qa(
            identifier,
            plan.source.path,
            output,
            report_path,
            plan=plan,
            fast=bool(params.get("fast_qa", True)),
        )
        return {
            "output": str(output),
            "report": str(report_path),
            "result": {
                "source_offset": (
                    float(params.get("sample_start", 0)) if params.get("mode") == "sample" else 0
                )
            },
        }

    def _qa(
        self,
        identifier: str,
        source: Path,
        output: Path,
        destination: Path,
        *,
        plan: Any = None,
        fast: bool = False,
        vs_corpus: bool = False,
    ) -> dict:
        from video_uniquifier.core.qa.corpus import Corpus
        from video_uniquifier.core.qa.report import build_report, render_html, write_json

        report = build_report(
            source,
            output,
            plan=plan,
            samples=12 if fast else 120,
            run_vmaf=not fast,
            run_ssim=not fast,
            predict_cid=False,
            vs_corpus=Corpus() if vs_corpus else None,
            cancel_token=self.tokens[identifier],
            progress=lambda phase, frac: self._update(
                identifier, stage=f"quality:{phase}", progress=0.8 + frac * 0.19
            ),
        )
        write_json(report, destination)
        render_html(report, plan, destination.with_suffix(".html"))
        return json_data(report)

    def _tool(self, identifier: str, params: dict, work: Path) -> dict:
        source = Path(params["source"])
        kind = params["kind"]
        if kind == "qa":
            output = Path(params["comparison"])
            destination = work / "report.json"
            self._qa(
                identifier,
                source,
                output,
                destination,
                fast=params.get("fast_qa", False),
                vs_corpus=params.get("vs_corpus", False),
            )
            return {"output": str(output), "report": str(destination)}
        if kind == "corpus":
            from video_uniquifier.core.qa.corpus import Corpus

            return {
                "result": json_data(Corpus().add(source, samples=int(params.get("samples", 60))))
            }
        if kind == "calibrate":
            from video_uniquifier.core.calibration.loop import CalibrationTarget, calibrate

            steps = []

            def step(value: Any) -> None:
                steps.append(json_data(value))
                self._update(
                    identifier,
                    result={"steps": list(steps)},
                    stage="calibrating",
                    progress=len(steps) / int(params.get("iterations", 5)),
                )

            result = calibrate(
                input_path=source,
                base_profile=self._profile(params.get("profile")),
                target=CalibrationTarget(
                    max_self_match=float(params.get("max_self_match", 0.2)),
                    min_quality=float(params.get("min_quality", 88)),
                    max_iterations=int(params.get("iterations", 5)),
                    test_clip_sec=float(params.get("sample_duration", 60)),
                ),
                work_dir=work,
                encoder_override=params.get("encoder") or None,
                on_step=step,
                cancel_token=self.tokens[identifier],
                metric="chromaprint",
            )
            path = self.profile_root / f"tuned-{identifier}.yaml"
            dump_profile(result.profile, path)
            return {
                "result": {
                    "steps": steps,
                    "profile": str(path),
                    "converged": result.converged,
                    "factor": result.factor,
                    "quality": result.final_quality,
                    "self_match": result.final_self_match,
                }
            }
        if kind == "variants":
            count = int(params.get("count", 3))
            if not 1 <= count <= 30:
                raise ValueError("实验版本数量必须在 1 到 30 之间。")
            variants = []
            for index in range(count):
                check_cancel(self.tokens[identifier])
                result = self._native(
                    identifier,
                    {**params, "new_variant": True, "variant_index": index + 1},
                    work / str(index),
                )
                variants.append({**result, "variant_id": index + 1})
                self._update(
                    identifier, result={"variants": variants}, progress=(index + 1) / count
                )
            return {"result": {"variants": variants}}
        if kind == "filequeue":
            return self._drain_queue(identifier, params, work)
        raise ValueError("未知工具任务。")

    def _drain_queue(self, identifier: str, params: dict, work: Path) -> dict:
        from video_uniquifier.core.queue.leasing import FileQueue

        queue = FileQueue(Path(params["source"]))
        destination = Path(params["output_dir"])
        destination.mkdir(parents=True, exist_ok=True)
        queue.recover_commits(destination)
        stopped = threading.Event()

        def heartbeat() -> None:
            while not stopped.wait(10):
                queue.heartbeat()

        pulse = threading.Thread(target=heartbeat, daemon=True)
        pulse.start()
        completed = []
        try:
            while not self.tokens[identifier].is_cancelled():
                queue.reap_stale()
                leased = queue.lease()
                if leased is None:
                    break
                profile = Profile.model_validate(params["native_profile"])
                output = destination / f"{leased.stem}.uniq.{profile.output_container}"
                staged = queue.staged_output_path(output)
                try:
                    plan = build_plan(leased, profile, params.get("encoder") or None)
                    run_full(
                        plan,
                        RunOptions(work_dir=work / plan.plan_hash, output=staged),
                        cancel_token=self.tokens[identifier],
                    )
                    original = queue.commit_output(leased, staged, output)
                    completed.append({"source": str(original), "output": str(output)})
                    self._update(
                        identifier, result={"completed": list(completed)}, stage="processing"
                    )
                except Exception as error:
                    staged.unlink(missing_ok=True)
                    if leased.exists():
                        queue.release_failed(leased, str(error))
                    check_cancel(self.tokens[identifier])
        finally:
            stopped.set()
            pulse.join(timeout=2)
        return {"result": {"completed": completed}}

    def action(self, identifier: str, action: str) -> dict:
        with self.lock:
            job = self.jobs[identifier]
            if action == "retry":
                if job["status"] not in {"failed", "cancelled"}:
                    raise ValueError("仅可重试失败或取消的任务。")
                return self.submit(job["params"])
            if job["status"] in TERMINAL:
                return dict(job)
            if action == "cancel":
                self.tokens[identifier].cancel()
                self.pauses[identifier].resume()
                if self.futures[identifier].cancel():
                    self._update(identifier, status="cancelled", stage="cancelled")
                else:
                    self._update(identifier, stage="cancelling")
            elif action in {"pause", "resume"}:
                if job["kind"] != "native" or job["status"] == "queued":
                    raise ValueError("当前任务不支持暂停。")
                getattr(self.pauses[identifier], action)()
                self._update(identifier, status="paused" if action == "pause" else "running")
            else:
                raise ValueError("未知任务操作。")
            return dict(job)

    def dispatch(self, method: str, params: dict) -> Any:
        if method == "history.import":
            return self.import_history(Path(params["path"]))
        if method == "bootstrap":
            rules_path = self.root / "delivery.yaml"
            return {
                "version": __version__,
                "profiles": self.profiles(),
                "rules": (
                    load_rules(rules_path) if rules_path.exists() else ReelsRules()
                ).model_dump(mode="json"),
                "root": str(self.root),
                "jobs": list(self.jobs.values()),
                "tools": {
                    tool: bool(shutil.which(tool)) for tool in ("ffmpeg", "ffprobe", "fpcalc")
                },
            }
        if method == "jobs.list":
            with self.lock:
                return list(self.jobs.values())
        if method == "jobs.submit":
            return self.submit(params)
        if method == "jobs.action":
            return self.action(params["id"], params["action"])
        if method == "report.read":
            job = self.jobs[params["id"]]
            if not job.get("report"):
                raise ValueError("此任务还没有质量报告。")
            return json_object(Path(job["report"]))
        if method == "profiles.list":
            return self.profiles()
        if method == "config.validate":
            return self.validate_yaml(params["yaml"], params.get("kind", "native"))
        if method == "rules.save":
            data = self.validate_yaml(params["yaml"], "reels")
            (self.root / "delivery.yaml").write_text(
                yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
            )
            return data
        if method == "profiles.save":
            data = self.validate_yaml(params["yaml"], "native")
            name = params["name"]
            if not re.fullmatch(r"[\w\-]{1,64}", name):
                raise ValueError("配置名称只允许文字、数字、下划线和连字符，最多 64 个字符。")
            destination = self.profile_root / f"{name}.yaml"
            if destination.exists() and not params.get("overwrite"):
                raise ValueError("配置已存在，请换一个名称或选择保存当前配置。")
            dump_profile(Profile.model_validate(data), destination)
            return self.profiles()
        if method == "corpus.list":
            from video_uniquifier.core.qa.corpus import Corpus

            return [json_data(entry) for entry in Corpus().list_all()]
        if method == "corpus.remove":
            from video_uniquifier.core.qa.corpus import Corpus

            return Corpus().remove(params["id"])
        if method == "probe":
            from video_uniquifier.core.probe import probe

            return json_data(probe(Path(params["path"])))
        if method.startswith("queue."):
            from video_uniquifier.core.queue.leasing import FileQueue, init_queue

            root = Path(params["root"])
            if method == "queue.init":
                init_queue(root)
            queue = FileQueue(root)
            if method == "queue.add":
                for source in params["files"]:
                    queue.add(Path(source))
            elif method == "queue.recover":
                queue.reap_stale()
            rows = []
            for bucket in ("pending", "in_progress", "done", "failed"):
                for path in getattr(queue.layout, bucket).rglob("*"):
                    if (
                        path.is_file()
                        and not path.name.startswith(".")
                        and not path.name.endswith((".alive", ".err.txt"))
                    ):
                        rows.append({"path": str(path), "name": path.name, "bucket": bucket})
            return {"stats": queue.stats(), "files": rows}
        raise ValueError(f"未知桌面调用：{method}")

    def import_history(self, path: Path) -> int:
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("历史记录文件不能超过 8 MiB。")
        entries = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            raise ValueError("请选择旧版桌面端的 history.json。")
        added = 0
        with self.lock:
            for entry in entries[:1000]:
                if not isinstance(entry, dict) or not entry.get("source_path"):
                    continue
                identifier = (
                    "legacy-"
                    + hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest()[:24]
                )
                if identifier in self.jobs:
                    continue
                output = Path(entry.get("output_path") or "missing.mp4")
                report = output.parent / "report.json"
                kind = "reels" if report.is_file() else "native"
                if kind == "native":
                    report = output.with_suffix(output.suffix + ".qa.json")
                try:
                    timestamp = datetime.fromisoformat(entry["timestamp"]).timestamp()
                except (KeyError, TypeError, ValueError):
                    continue
                source = entry["source_path"]
                status = {"done": "success", "failed": "failed", "cancelled": "cancelled"}.get(
                    entry.get("status"), "failed"
                )
                self.jobs[identifier] = {
                    "id": identifier,
                    "kind": kind,
                    "mode": "export",
                    "source": source,
                    "name": Path(source).name,
                    "status": status,
                    "progress": 1 if status == "success" else 0,
                    "stage": status,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "params": {"imported": True},
                    "error": None,
                    "output": str(output) if output.is_file() else None,
                    "report": str(report) if report.is_file() else None,
                    "result": {"source_offset": 0},
                    "logs": [],
                }
                added += 1
            self._save()
        return added

    def close(self) -> None:
        self.closed = True
        for identifier, token in list(self.tokens.items()):
            if self.jobs[identifier]["status"] not in TERMINAL:
                token.cancel()
                self.pauses[identifier].resume()
        self.pool.shutdown(wait=True, cancel_futures=False)
