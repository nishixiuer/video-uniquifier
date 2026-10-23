"""Private line-delimited JSON desktop transport. No HTTP server or PyQt imports."""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from pathlib import Path

if getattr(sys, "frozen", False):
    os.environ["PATH"] = str(Path(sys._MEIPASS) / "bin") + os.pathsep + os.environ["PATH"]

from desktop_engine import DesktopEngine  # noqa: E402


def main() -> None:
    # The existing scene adapter launches `sys.executable -m ...`. In a frozen
    # distribution sys.executable is this binary, so dispatch that private worker
    # explicitly rather than trying to start a second desktop service.
    if sys.argv[1:3] == ["-m", "video_uniquifier.core.reels.scene_worker"]:
        from video_uniquifier.core.reels.scene_worker import main as scene_worker

        sys.argv = [sys.argv[2], *sys.argv[3:]]
        scene_worker()
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    lock = threading.Lock()
    transport = sys.stdout

    def send(payload: dict) -> None:
        with lock:
            transport.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
            transport.flush()

    sys.stdout = sys.stderr
    engine = DesktopEngine(args.root, emit=lambda job: send({"event": "job", "data": job}))
    send({"event": "ready"})
    try:
        for line in sys.stdin:
            request = {}
            try:
                request = json.loads(line)
                result = engine.dispatch(request["method"], request.get("params", {}))
                send({"id": request["id"], "result": result})
            except Exception as error:
                send({"id": request.get("id"), "error": str(error)})
    finally:
        engine.close()


if __name__ == "__main__":
    main()
