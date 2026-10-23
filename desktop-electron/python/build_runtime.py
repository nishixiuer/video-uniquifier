"""Freeze the existing core and media executables without a PyQt dependency."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def runtime_fingerprint() -> str:
    digest = hashlib.sha256()
    digest.update(f"{sys.version}|{platform.machine()}|{platform.system()}".encode())
    for name in (
        "video-uniquifier",
        "pydantic",
        "pyinstaller",
        "scenedetect",
        "numpy",
        "Pillow",
        "scipy",
    ):
        digest.update(f"{name}=={version(name)}".encode())
    roots = [
        ROOT / "src/video_uniquifier/core",
        ROOT / "src/video_uniquifier/profiles",
        ROOT / "src/video_uniquifier/keys",
        ROOT / "custom_profiles",
    ]
    sources = [
        HERE / "bridge.py",
        HERE / "desktop_engine.py",
        Path(__file__),
        ROOT / "pyproject.toml",
    ]
    for root in roots:
        sources.extend(
            path
            for path in root.rglob("*")
            if path.suffix in {".py", ".yaml", ".j2", ".json", ".pub"}
        )
    for path in sorted(sources):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    for tool in ("ffmpeg", "ffprobe", "fpcalc"):
        executable = shutil.which(tool)
        digest.update(str(executable).encode())
        if executable:
            info = Path(executable).stat()
            digest.update(f"{info.st_size}:{info.st_mtime_ns}".encode())
    return digest.hexdigest()


def build_command() -> list[str]:
    import PyInstaller  # noqa: F401

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--onedir",
        "--name",
        "video-uniquifier-python",
        "--distpath",
        str(HERE / "dist"),
        "--workpath",
        str(HERE / "build"),
        "--specpath",
        str(HERE / "build"),
        "--paths",
        str(ROOT / "src"),
        "--collect-data",
        "video_uniquifier",
        "--collect-submodules",
        "video_uniquifier.core.transforms",
        "--hidden-import",
        "video_uniquifier.core.reels.scene_worker",
        "--collect-all",
        "scenedetect",
        "--copy-metadata",
        "video-uniquifier",
        "--exclude-module",
        "PyQt6",
        "--exclude-module",
        "torch",
        "--exclude-module",
        "torchvision",
        "--exclude-module",
        "tkinter",
    ]
    separator = os.pathsep
    command += [
        "--add-data",
        (
            f"{ROOT / 'custom_profiles/facebook_reels_base.yaml'}"
            f"{separator}video_uniquifier/core/reels"
        ),
    ]
    for tool in ("ffmpeg", "ffprobe", "fpcalc"):
        executable = shutil.which(tool)
        if not executable and tool != "fpcalc":
            raise SystemExit(f"打包前必须在 PATH 中安装 {tool}。")
        if executable:
            command += ["--add-binary", f"{executable}{separator}bin"]
    command.append(str(HERE / "bridge.py"))
    return command


def main() -> None:
    try:
        fingerprint = runtime_fingerprint()
        marker = HERE / "dist/fingerprint.json"
        executable = (
            HERE
            / "dist/video-uniquifier-python"
            / (
                "video-uniquifier-python.exe"
                if sys.platform == "win32"
                else "video-uniquifier-python"
            )
        )
        if (
            marker.exists()
            and executable.exists()
            and "--force" not in sys.argv
            and json.loads(marker.read_text())["fingerprint"] == fingerprint
        ):
            print("Python 引擎未修改，复用已打包运行时。")
            return
        command = build_command()
    except ImportError:
        raise SystemExit(f"请先安装打包工具：{sys.executable} -m pip install pyinstaller") from None
    subprocess.run(command, cwd=ROOT, check=True)
    marker.write_text(json.dumps({"fingerprint": fingerprint}))
    print(f"Python runtime ready: {HERE / 'dist/video-uniquifier-python'}")


if __name__ == "__main__":
    main()
