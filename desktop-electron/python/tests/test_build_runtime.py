"""Packaging cache must rebuild engine changes and reuse frontend-only changes."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_runtime as build


def test_fingerprint_ignores_react_and_detects_core_changes(tmp_path, monkeypatch):
    here = tmp_path / "desktop-electron/python"
    here.mkdir(parents=True)
    for name in ("bridge.py", "desktop_engine.py", "build_runtime.py"):
        (here / name).write_text("initial")
    (tmp_path / "pyproject.toml").write_text("initial")
    core = tmp_path / "src/video_uniquifier/core"
    core.mkdir(parents=True)
    (core / "processor.py").write_text("initial")
    monkeypatch.setattr(build, "ROOT", tmp_path)
    monkeypatch.setattr(build, "HERE", here)
    monkeypatch.setattr(build, "__file__", str(here / "build_runtime.py"))
    monkeypatch.setattr(build, "version", lambda _name: "1")
    monkeypatch.setattr(build.shutil, "which", lambda _name: None)
    before = build.runtime_fingerprint()
    (tmp_path / "desktop-electron/ui.tsx").write_text("new frontend")
    assert build.runtime_fingerprint() == before
    (core / "processor.py").write_text("updated engine")
    assert build.runtime_fingerprint() != before


def test_package_reuses_cache_and_rebuilds_when_required(tmp_path, monkeypatch):
    dist = tmp_path / "dist/video-uniquifier-python"
    dist.mkdir(parents=True)
    executable = dist / (
        "video-uniquifier-python.exe" if sys.platform == "win32" else "video-uniquifier-python"
    )
    executable.touch()
    marker = tmp_path / "dist/fingerprint.json"
    marker.write_text(json.dumps({"fingerprint": "initial"}))
    monkeypatch.setattr(build, "HERE", tmp_path)
    monkeypatch.setattr(build, "runtime_fingerprint", lambda: "initial")
    invoked = []
    monkeypatch.setattr(build, "build_command", lambda: ["pyinstaller"])
    monkeypatch.setattr(build.subprocess, "run", lambda *args, **_kwargs: invoked.append(args))
    build.main()
    assert not invoked
    monkeypatch.setattr(build, "runtime_fingerprint", lambda: "changed")
    build.main()
    assert invoked
    assert json.loads(marker.read_text())["fingerprint"] == "changed"
