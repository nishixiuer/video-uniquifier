"""Verify the distributed runtime with no project Python/ffmpeg on PATH."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

RUNTIME = Path(__file__).resolve().parents[1] / "dist" / "video-uniquifier-python"
EXECUTABLE = RUNTIME / (
    "video-uniquifier-python.exe" if sys.platform == "win32" else "video-uniquifier-python"
)


@pytest.mark.integration
@pytest.mark.skipif(not EXECUTABLE.exists(), reason="Build the Python runtime first")
def test_frozen_processing_without_project_environment(tmp_path):
    clean_env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONPATH", "VIRTUAL_ENV", "FFMPEG_BINARY", "FFPROBE_BINARY"}
    }
    clean_env["PATH"] = "/usr/bin:/bin" if sys.platform != "win32" else os.environ["SYSTEMROOT"]
    ffmpeg = RUNTIME / "_internal" / "bin" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    source = tmp_path / "input.mp4"
    subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x224:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        env=clean_env,
        check=True,
    )
    proc = subprocess.Popen(
        [str(EXECUTABLE), "--root", str(tmp_path / "app-data")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=tmp_path,
        env=clean_env,
    )
    try:
        assert json.loads(proc.stdout.readline())["event"] == "ready"
        proc.stdin.write(json.dumps({"id": "1", "method": "bootstrap"}) + "\n")
        proc.stdin.flush()
        bootstrap = json.loads(proc.stdout.readline())["result"]
        assert bootstrap["tools"]["ffmpeg"] and bootstrap["tools"]["ffprobe"]
        assert bootstrap["profiles"]
        proc.stdin.write(
            json.dumps(
                {
                    "id": "2",
                    "method": "jobs.submit",
                    "params": {
                        "kind": "reels",
                        "source": str(source),
                        "rules": {
                            "video": {"width": 720, "height": 1280},
                            "scenes": {
                                "detect_enabled": True,
                                "blackdetect_enabled": False,
                                "silence_detect_enabled": False,
                            },
                            "quality_gate": {"sample_preview_enabled": False},
                        },
                    },
                }
            )
            + "\n"
        )
        proc.stdin.flush()
        while True:
            line = proc.stdout.readline()
            assert line, proc.stderr.read()
            payload = json.loads(line)
            if payload.get("event") == "job" and payload["data"]["status"] in {"success", "failed"}:
                assert payload["data"]["status"] == "success", payload["data"]["error"]
                assert Path(payload["data"]["output"]).is_file()
                break
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
