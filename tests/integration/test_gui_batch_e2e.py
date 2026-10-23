"""End-to-end: BatchScreen with a 2-file batch via BatchWorker.

Real ffmpeg runs are exercised by the Run e2e; this asserts the screen
correctly wires BatchWorker signals into table state for each file.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from PyQt6.QtWidgets import QApplication

from tests.conftest import needs_ffmpeg

pytestmark = [pytest.mark.integration, needs_ffmpeg]


@pytest.fixture
def app():
    app = QApplication.instance() or QApplication([])
    yield app
    app.processEvents()


def _select_profile(combo, stem: str) -> bool:
    for i in range(combo.count()):
        if combo.itemText(i) == stem:
            combo.setCurrentIndex(i)
            return True
    return False


def test_batch_screen_two_files(app, qtbot, tiny_clip: Path, tmp_path: Path) -> None:
    """Two inputs → BatchWorker emits file_done twice → table rows update."""
    in_dir = tmp_path / "in"
    in_dir.mkdir()
    shutil.copy(tiny_clip, in_dir / "a.mp4")
    shutil.copy(tiny_clip, in_dir / "b.mp4")
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    from video_uniquifier.gui.screens.batch import BatchScreen
    from video_uniquifier.gui.state import AppState

    state = AppState()
    screen = BatchScreen(state)
    qtbot.addWidget(screen)

    screen.input_dir = in_dir
    screen.output_dir = out_dir
    screen.input_label.setText(str(in_dir))
    screen.output_label.setText(str(out_dir))
    assert _select_profile(screen.profile_combo, "soft")
    screen._refresh_preview()  # populates table from glob pattern
    screen._refresh_run_btn()
    app.processEvents()

    assert screen.table.rowCount() == 2, (
        f"preview should show 2 files, got {screen.table.rowCount()}"
    )


def test_batch_screen_no_files_shows_status(app, qtbot, tmp_path: Path) -> None:
    """An empty matched preview cannot start an empty batch."""
    in_dir = tmp_path / "in"
    in_dir.mkdir()
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    from video_uniquifier.gui.screens.batch import BatchScreen
    from video_uniquifier.gui.state import AppState

    state = AppState()
    screen = BatchScreen(state)
    qtbot.addWidget(screen)
    screen.input_dir = in_dir
    screen.output_dir = out_dir
    screen.input_label.setText(str(in_dir))
    screen.output_label.setText(str(out_dir))
    _select_profile(screen.profile_combo, "soft")
    screen._refresh_preview()
    screen._refresh_run_btn()
    app.processEvents()

    screen._on_run()
    app.processEvents()
    assert screen.worker is None
    assert not screen.run_btn.isEnabled()
    assert not screen.run_selected_btn.isEnabled()
    assert screen.table.rowCount() == 0
    assert "0 files matched" in screen.status_label.text()


def test_default_reels_batch_encodes_same_named_sources_and_reopens_reports(
    app, qtbot, tiny_clip: Path, tmp_path: Path, monkeypatch,
) -> None:
    """Real QThread/core results survive reload and keep independent review artifacts."""
    from video_uniquifier.gui.screens.batch import BatchScreen
    from video_uniquifier.gui.screens.history import HistoryScreen
    from video_uniquifier.gui.state import AppState
    from video_uniquifier.gui.widgets.encoder_selector import EncoderSelector

    monkeypatch.setattr(EncoderSelector, "_start_detection", lambda self: None)
    input_dir = tmp_path / "input"
    for name in ("episode-1", "episode-2"):
        directory = input_dir / name
        directory.mkdir(parents=True)
        shutil.copyfile(tiny_clip, directory / "clip.mp4")
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.input_dir, screen.output_dir = input_dir, tmp_path / "exports"
    screen.pattern_edit.setText("**/*.mp4")
    screen.reels_options.resolution.setCurrentIndex(1)
    screen.reels_options.detect_scenes.setChecked(False)
    screen._refresh_preview()
    assert screen.method.combo.currentData() == "reels"
    assert screen.table.rowCount() == 2
    screen._on_run()
    try:
        qtbot.waitUntil(lambda: screen.worker is None, timeout=120000)
        entries = AppState().history
        assert len(entries) == 2, screen.status_label.text()
        assert len({entry.output_path for entry in entries}) == 2
        screen.table.open_requested.emit(entries[0].output_path)
        assert screen._player is not None
        qtbot.waitUntil(lambda: screen._player._frames[1].isValid(), timeout=15000)
        assert screen._player.players[0].source().isEmpty()
        history = HistoryScreen(AppState())
        qtbot.addWidget(history)
        for entry in entries:
            output = Path(entry.output_path)
            assert output.is_file()
            report = json.loads((output.parent / "report.json").read_text())
            assert report["quality_check"]["status"] == "passed"
            assert report["output"]["video"][0]["width"] == 720
            history._open_report(entry)
            assert history._report_dialog is not None and history._report_dialog.isVisible()
        assert history.shutdown_workers()
    finally:
        assert screen.shutdown_workers()
