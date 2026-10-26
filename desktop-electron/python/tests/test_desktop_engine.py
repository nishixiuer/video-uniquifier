"""Desktop adapter contracts, error handling, persistence and real processing."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_engine as module
from desktop_engine import DesktopEngine, json_data


@pytest.fixture
def engine(tmp_path):
    value = DesktopEngine(tmp_path / "data")
    yield value
    value.close()


@pytest.fixture
def source(tmp_path):
    path = tmp_path / "input.mp4"
    path.write_bytes(b"source")
    return path


def wait(engine, job):
    engine.futures[job["id"]].result(timeout=30)
    return engine.jobs[job["id"]]


def fake_reels(source, rules, root, *, job_id, on_status, **_kwargs):
    folder = root / "results" / job_id
    folder.mkdir(parents=True)
    (folder / "output.mp4").write_bytes(b"output")
    (folder / "report.json").write_text('{"status":"success","quality_check":{"failures":[]}}')
    on_status("processing", 0.5)
    return folder


def test_bootstrap_profiles_and_paths(engine):
    data = engine.dispatch("bootstrap", {})
    assert data["profiles"] and "ffmpeg" in data["tools"]
    assert data["rules"]["video"]["width"] == 1080
    # pytest-qt may load Qt before fixtures; check a fresh Python interpreter.
    check = subprocess.run(
        [sys.executable, "-c", "import desktop_engine, sys; print('PyQt6' in sys.modules)"],
        cwd=Path(module.__file__).parent,
        text=True,
        capture_output=True,
        check=True,
    )
    assert check.stdout.strip() == "False"
    assert engine.dispatch("jobs.list", {}) == []


def test_reels_export_and_restart(engine, source, tmp_path, monkeypatch):
    monkeypatch.setattr(module, "process_video", fake_reels)
    output = tmp_path / "export"
    job = engine.submit({"source": str(source), "output_dir": str(output)})
    result = wait(engine, job)
    assert result["status"] == "success"
    assert Path(result["output"]).is_relative_to(output)
    assert Path(result["report"]).exists()
    assert source.read_bytes() == b"source"
    assert engine.dispatch("report.read", {"id": job["id"]})["status"] == "success"
    restored = DesktopEngine(engine.root)
    try:
        assert restored.jobs[job["id"]]["output"] == result["output"]
    finally:
        restored.close()


def test_production_request_is_idempotent_and_survives_restart(engine, source, monkeypatch):
    monkeypatch.setattr(module, "process_video", fake_reels)
    params = {"source": str(source), "request_key": f"{uuid4()}:1"}
    first = engine.submit(params)
    assert engine.submit(params)["id"] == first["id"]
    assert wait(engine, first)["status"] == "success"
    assert len(engine.jobs) == 1
    with pytest.raises(ValueError, match="不能修改"):
        engine.submit({**params, "rules": {"video": {"crf": 18}}})
    with pytest.raises(ValueError, match="编号"):
        engine.submit({"source": str(source), "request_key": "invalid"})
    restored = DesktopEngine(engine.root)
    try:
        assert restored.submit(params)["id"] == first["id"]
        assert len(restored.jobs) == 1
    finally:
        restored.close()


def test_production_history_survives_normal_job_retention(engine):
    production = {
        "id": "production", "status": "success",
        "params": {"request_key": f"{uuid4()}:1"},
    }
    engine.jobs[production["id"]] = production
    for index in range(1001):
        engine.jobs[str(index)] = {"id": str(index), "status": "success", "params": {}}
    engine._save()
    saved = json.loads((engine.root / "jobs.json").read_text())["jobs"]
    assert len(saved) == 1001
    assert saved[0] == production
    assert not any(job["id"] == "0" for job in saved)


@pytest.mark.parametrize(
    "params",
    [
        {"kind": "unknown"},
        {"mode": "unknown"},
        {"rules": {"video": {"width": 999}}},
        {"rules": {"unexpected": True}},
    ],
)
def test_reject_invalid_configuration(engine, source, params):
    with pytest.raises(ValueError):
        engine.submit({"source": str(source), **params})
    assert not engine.jobs


def test_missing_source_and_unknown_method(engine):
    with pytest.raises(ValueError):
        engine.submit({"source": "/not-a-source.mp4"})
    with pytest.raises(ValueError):
        engine.dispatch("unknown", {})


def test_failure_retry_and_cancellation(engine, source, monkeypatch):
    def fail(*_args, **_kwargs):
        raise ValueError("broken source")

    monkeypatch.setattr(module, "process_video", fail)
    job = engine.submit({"source": str(source)})
    assert wait(engine, job)["status"] == "failed"
    monkeypatch.setattr(module, "process_video", fake_reels)
    retried = engine.dispatch("jobs.action", {"id": job["id"], "action": "retry"})
    assert wait(engine, retried)["status"] == "success"
    assert retried["id"] != job["id"]
    with pytest.raises(ValueError):
        engine.action(retried["id"], "retry")
    assert engine.action(retried["id"], "cancel")["status"] == "success"


def test_cancel_queued_and_running(engine, source, monkeypatch):
    def cancellable(*_args, cancel_token, **_kwargs):
        while not cancel_token.wait(0.01):
            pass
        raise ValueError("cancelled")

    monkeypatch.setattr(module, "process_video", cancellable)
    running = engine.submit({"source": str(source)})
    queued = engine.submit({"source": str(source)})
    engine.action(queued["id"], "cancel")
    engine.action(running["id"], "cancel")
    assert wait(engine, running)["status"] == "cancelled"
    assert engine.jobs[queued["id"]]["status"] == "cancelled"


def test_interrupted_job_is_recoverable(tmp_path):
    (tmp_path / "jobs.json").write_text(json.dumps({"jobs": [{"id": "abc", "status": "running"}]}))
    engine = DesktopEngine(tmp_path)
    assert engine.jobs["abc"]["status"] == "failed"
    engine.close()


def test_yaml_validation_and_profile_save(engine):
    native = engine.profiles()[0]["yaml"]
    assert engine.validate_yaml(native, "native")["name"]
    profiles = engine.dispatch("profiles.save", {"yaml": native, "name": "测试配置"})
    assert any(profile["custom"] for profile in profiles)
    with pytest.raises(ValueError):
        engine.dispatch("profiles.save", {"yaml": native, "name": "../escape"})
    with pytest.raises(ValueError):
        engine.dispatch("profiles.save", {"yaml": native, "name": "测试配置"})
    engine.dispatch("profiles.save", {"yaml": native, "name": "测试配置", "overwrite": True})
    with pytest.raises(ValueError):
        engine.validate_yaml("x" * 300_000, "native")
    with pytest.raises(ValueError):
        engine.dispatch("config.validate", {"yaml": "unknown: true", "kind": "reels"})
    rules = engine.dispatch("rules.save", {"yaml": "video:\n  width: 720\n  height: 1280\n"})
    assert rules["video"]["width"] == 720
    assert engine.dispatch("bootstrap", {})["rules"]["video"]["width"] == 720


def test_export_preserves_existing(engine, tmp_path):
    source = tmp_path / "result"
    source.mkdir()
    (source / "output.mp4").write_bytes(b"new")
    target = tmp_path / "destination"
    first = engine._export(source, target, "id", "clip")
    with pytest.raises(FileExistsError):
        engine._export(source, target, "id", "clip")
    assert (first / "output.mp4").read_bytes() == b"new"
    assert not (target / ".id.exporting").exists()


def test_report_pending_error(engine, source, monkeypatch):
    monkeypatch.setattr(
        module,
        "process_video",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("failed")),
    )
    job = engine.submit({"source": str(source)})
    wait(engine, job)
    with pytest.raises(ValueError):
        engine.dispatch("report.read", {"id": job["id"]})


def test_stdio_transport(tmp_path):
    request = json.dumps({"id": "1", "method": "bootstrap", "params": {}}) + "\n"
    result = subprocess.run(
        [
            sys.executable,
            str(Path(module.__file__).with_name("bridge.py")),
            "--root",
            str(tmp_path / "data"),
        ],
        input=request,
        text=True,
        capture_output=True,
        check=True,
        timeout=20,
    )
    lines = [json.loads(line) for line in result.stdout.splitlines()]
    assert lines[0]["event"] == "ready"
    assert lines[1]["id"] == "1"
    assert lines[1]["result"]["profiles"]


def test_serialization():
    @dataclass
    class Item:
        path: Path
        count: int

    assert json_data(Item(Path("/tmp/a"), 0)) == {"path": "/tmp/a", "count": 0}
    assert json_data(module.ReelsRules())["schema_version"] == 1
    assert json_data(False) is False


def test_dispatch_profile_and_bounds(engine, source):
    assert engine.dispatch("profiles.list", {})
    with pytest.raises(ValueError):
        engine._profile("missing")
    engine.closed = True
    with pytest.raises(ValueError):
        engine.submit({"source": str(source)})
    engine.closed = False
    engine.jobs = {str(index): {"status": "queued"} for index in range(100)}
    with pytest.raises(ValueError):
        engine.submit({"source": str(source)})
    engine.jobs.clear()


def test_pause_resume_and_invalid_action(engine, source, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def slow(*_args):
        started.set()
        release.wait(5)
        return {}

    monkeypatch.setattr(engine, "_native", slow)
    job = engine.submit({"source": str(source), "kind": "native"})
    assert started.wait(5)
    try:
        assert engine.action(job["id"], "pause")["status"] == "paused"
        assert engine.pauses[job["id"]].is_paused()
        assert engine.action(job["id"], "resume")["status"] == "running"
        with pytest.raises(ValueError):
            engine.action(job["id"], "bad-action")
        queued = engine.submit({"source": str(source)})
        with pytest.raises(ValueError):
            engine.action(queued["id"], "pause")
        with pytest.raises(ValueError):
            engine.action(job["id"], "retry")
        engine.action(queued["id"], "cancel")
    finally:
        release.set()
    assert wait(engine, job)["status"] == "success"


def test_preflight_and_sample_rules(engine, source, monkeypatch):
    import video_uniquifier.core.reels.packaging as packaging

    seen = []
    monkeypatch.setattr(module, "inspect_source", lambda *_args: SimpleNamespace(duration_sec=20))
    monkeypatch.setattr(module, "prepare_plan", lambda *_args: (None, ["检查通过"]))
    monkeypatch.setattr(module, "json_data", lambda value: {"duration_sec": value.duration_sec})
    monkeypatch.setattr(packaging, "render_layers", lambda *_args: ([], [], []))
    preflight = engine.submit({"source": str(source), "mode": "preflight"})
    assert wait(engine, preflight)["result"]["findings"] == ["检查通过"]

    def process(source, rules, root, **kwargs):
        seen.append(rules)
        return fake_reels(source, rules, root, **kwargs)

    monkeypatch.setattr(module, "process_video", process)
    sample = engine.submit({"source": str(source), "mode": "sample", "sample_duration": 5})
    assert wait(engine, sample)["status"] == "success"
    assert seen[0].scenes.trim_end_sec == 15
    invalid = engine.submit({"source": str(source), "mode": "sample", "sample_duration": 0})
    assert wait(engine, invalid)["status"] == "failed"


@pytest.mark.parametrize("asset", [{"../escape.png": "none"}, {"logo.png": "not-a-file"}])
def test_invalid_packaging_assets(engine, source, asset):
    job = engine.submit({"source": str(source), "assets": asset})
    assert wait(engine, job)["status"] == "failed"


def test_logo_asset_copy(engine, source, tmp_path, monkeypatch):
    logo = tmp_path / "logo.png"
    logo.write_bytes(b"image")

    def process(source, rules, root, **kwargs):
        assert (kwargs["asset_root"] / "logo.png").read_bytes() == b"image"
        return fake_reels(source, rules, root, **kwargs)

    monkeypatch.setattr(module, "process_video", process)
    job = engine.submit({"source": str(source), "assets": {"logo.png": str(logo)}})
    assert wait(engine, job)["status"] == "success"


def test_native_preflight_sample_and_variants(engine, source, monkeypatch):
    import video_uniquifier.core._review_sample as sample_module
    import video_uniquifier.core.preflight as preflight_module

    plan = SimpleNamespace(source=SimpleNamespace(path=source, duration_sec=2), encoder=None)
    monkeypatch.setattr(module, "build_plan", lambda *_args: plan)
    monkeypatch.setattr(module, "json_data", lambda _value: {"level": "info"})
    monkeypatch.setattr(
        preflight_module, "preflight", lambda *_args: [SimpleNamespace(level="info")]
    )
    monkeypatch.setattr(sample_module, "_prepare_review_sample", lambda *_args, **_kwargs: plan)
    monkeypatch.setattr(engine, "_qa", lambda *_args, **_kwargs: {})

    def run(_plan, options, on_event=None, **_kwargs):
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_bytes(b"native-output")
        if on_event:
            on_event(module.RunEvent("log", {}))
            on_event(module.RunEvent("progress", {"segment": 0, "out_time_us": "1000000"}))
            on_event(module.RunEvent("progress", {"phase": "concat"}))

    monkeypatch.setattr(module, "run_full", run)
    preflight = engine.submit({"source": str(source), "kind": "native", "mode": "preflight"})
    assert wait(engine, preflight)["result"]["findings"]
    sample = engine.submit(
        {"source": str(source), "kind": "native", "mode": "sample", "sample_start": 1}
    )
    sample_result = wait(engine, sample)
    assert sample_result["status"] == "success"
    assert sample_result["result"]["source_offset"] == 1
    full = engine.submit({"source": str(source), "kind": "native", "sample_start": 1})
    assert wait(engine, full)["result"]["source_offset"] == 0
    variants = engine.submit({"source": str(source), "kind": "variants", "count": 2})
    result = wait(engine, variants)
    outputs = [item["output"] for item in result["result"]["variants"]]
    assert len(set(outputs)) == 2
    invalid = engine.submit({"source": str(source), "kind": "variants", "count": 0})
    assert wait(engine, invalid)["status"] == "failed"


def test_standalone_qa(engine, source, monkeypatch):
    seen = []
    monkeypatch.setattr(engine, "_qa", lambda *args, **_kwargs: seen.append(args))
    job = engine.submit({"kind": "qa", "source": str(source), "comparison": str(source)})
    assert wait(engine, job)["status"] == "success"
    assert seen[0][1] == source


def test_calibration_result_and_profile_persistence(engine, source, monkeypatch):
    import video_uniquifier.core.calibration.loop as calibration

    def calibrate(*, base_profile, on_step, **_kwargs):
        on_step(SimpleNamespace())
        return SimpleNamespace(
            profile=base_profile, converged=True, factor=1, final_quality=95, final_self_match=0.1
        )

    monkeypatch.setattr(calibration, "calibrate", calibrate)
    monkeypatch.setattr(module, "json_data", lambda _value: {"iteration": 1, "quality": 95})
    job = engine.submit({"kind": "calibrate", "source": str(source)})
    result = wait(engine, job)
    assert result["status"] == "success"
    assert Path(result["result"]["profile"]).is_file()


def test_corpus_api(engine, source, monkeypatch):
    import video_uniquifier.core.qa.corpus as corpus

    class Corpus:
        def list_all(self):
            return [SimpleNamespace(id="item")]

        def add(self, _path, *, samples):
            return SimpleNamespace(id="item")

        def remove(self, entry_id):
            return entry_id == "item"

    monkeypatch.setattr(corpus, "Corpus", Corpus)
    monkeypatch.setattr(module, "json_data", lambda _value: {"id": "item"})
    assert engine.dispatch("corpus.list", {}) == [{"id": "item"}]
    assert engine.dispatch("corpus.remove", {"id": "item"})
    job = engine.submit({"kind": "corpus", "source": str(source)})
    assert wait(engine, job)["result"]["id"] == "item"


def test_filequeue_management_and_worker(engine, source, tmp_path, monkeypatch):
    root = tmp_path / "queue"
    assert engine.dispatch("queue.init", {"root": str(root)})["stats"]["pending"] == 0
    assert (
        engine.dispatch("queue.add", {"root": str(root), "files": [str(source)]})["stats"][
            "pending"
        ]
        == 1
    )
    assert source.exists()  # FileQueue links/copies; it never removes the user's source.
    assert engine.dispatch("queue.recover", {"root": str(root)})["files"]
    monkeypatch.setattr(module, "build_plan", lambda *_args: SimpleNamespace(plan_hash="hash"))

    def encode(_plan, options, **_kwargs):
        options.output.write_bytes(b"encoded")

    monkeypatch.setattr(module, "run_full", encode)
    job = engine.submit(
        {"kind": "filequeue", "source": str(root), "output_dir": str(tmp_path / "output")}
    )
    result = wait(engine, job)
    assert result["status"] == "success", result["error"]
    assert result["result"]["completed"]


def test_legacy_history_import_preserves_files_and_deduplicates(engine, source, tmp_path):
    output = tmp_path / "output.mp4"
    output.write_bytes(b"finished")
    report = tmp_path / "output.mp4.qa.json"
    report.write_text('{"vmaf_mean":95}')
    history = tmp_path / "history.json"
    history.write_text(
        json.dumps(
            [
                {
                    "timestamp": "2026-10-23T12:00:00",
                    "source_path": str(source),
                    "output_path": str(output),
                    "status": "done",
                },
                {"invalid": "row"},
            ]
        )
    )
    assert engine.dispatch("history.import", {"path": str(history)}) == 1
    assert engine.dispatch("history.import", {"path": str(history)}) == 0
    job = next(iter(engine.jobs.values()))
    assert job["status"] == "success"
    assert engine.dispatch("report.read", {"id": job["id"]})["vmaf_mean"] == 95
    assert output.read_bytes() == b"finished"
    history.write_text("{}")
    with pytest.raises(ValueError):
        engine.import_history(history)


@pytest.mark.integration
def test_real_reels_and_native_pipeline(engine, tmp_path):
    clip = tmp_path / "tiny.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x224:rate=30:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(clip),
        ],
        check=True,
    )
    job = engine.submit(
        {
            "source": str(clip),
            "kind": "reels",
            "rules": {
                "video": {"width": 720, "height": 1280},
                "scenes": {
                    "detect_enabled": False,
                    "blackdetect_enabled": False,
                    "silence_detect_enabled": False,
                },
                "quality_gate": {"sample_preview_enabled": False},
            },
        }
    )
    result = wait(engine, job)
    assert result["status"] == "success", result["error"]
    assert Path(result["output"]).stat().st_size > 0
    native = engine.submit({"source": str(clip), "kind": "native", "encoder": "libx264"})
    result = wait(engine, native)
    assert result["status"] == "success", result["error"]
    assert Path(result["report"]).is_file()
