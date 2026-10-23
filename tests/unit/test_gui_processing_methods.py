"""Default delivery entry points, persisted history review and sequential batch behavior."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from PyQt6.QtMultimedia import QMediaPlayer
from PyQt6.QtWidgets import QMessageBox, QPushButton, QTextBrowser

from video_uniquifier.core.reels.config import ReelsRules
from video_uniquifier.core.reels.runtime import ReelsError
from video_uniquifier.gui.app_pyqt import _resolve_boot_locale
from video_uniquifier.gui.i18n import active_locale, install_translator
from video_uniquifier.gui.screens.batch import BatchScreen
from video_uniquifier.gui.screens.history import HistoryScreen
from video_uniquifier.gui.state import AppState, HistoryEntry
from video_uniquifier.gui.widgets.delivery_report import DeliveryReportDialog
from video_uniquifier.gui.widgets.encoder_selector import EncoderSelector
from video_uniquifier.gui.widgets.studio_table import STATUS_ROLE
from video_uniquifier.gui.workers import reels_worker
from video_uniquifier.gui.workers.probe_worker import ProbeWorker
from video_uniquifier.gui.workers.reels_worker import ReelsBatchWorker


@pytest.fixture(autouse=True)
def quiet_desktop(qapp, monkeypatch):
    locale = active_locale()
    install_translator(qapp, "en_US")
    monkeypatch.setattr(EncoderSelector, "_start_detection", lambda self: None)
    monkeypatch.setattr(ProbeWorker, "start", lambda self: None)
    monkeypatch.setattr(QMediaPlayer, "setSource", lambda self, url: None)
    yield
    install_translator(qapp, locale)


@pytest.fixture
def completed(tmp_path):
    source = tmp_path / "original.mp4"
    source.touch()
    directory = tmp_path / "results" / "job"
    directory.mkdir(parents=True)
    (directory / "output.mp4").touch()
    report = {
        "source": {"filename": source.name, "duration_sec": 12},
        "output": {"duration_sec": 9}, "quality_check": {"status": "passed"},
        "effective_rules": {"scenes": {"trim_start_sec": 1, "trim_end_sec": 2}},
        "plan_hash": "hash", "warnings": [],
    }
    (directory / "report.json").write_text(json.dumps(report))
    entry = HistoryEntry(
        timestamp="2026-10-23T12:00:00", source_path=str(source),
        output_path=str(directory / "output.mp4"), profile_name="facebook_reels_drama_v1",
        encoder_name="libx264", status="done", plan_hash="hash", qa_html_path=None,
    )
    return entry, report


def test_single_entry_defaults_to_reels_and_preserves_both_workflows(
    gui_window_factory, qapp,
):
    window = gui_window_factory()
    entry = window.stack.widget(0)
    assert entry.method.combo.currentData() == "reels"
    assert entry.workflows.currentWidget() is entry.delivery
    entry.delivery.options.trim_start.setValue(2)
    entry.method.combo.setCurrentIndex(1)
    assert entry.workflows.currentWidget() is entry.native
    entry.native.profile_combo.setCurrentIndex(entry.native.profile_combo.findText("medium"))
    entry.method.combo.setCurrentIndex(0)
    assert entry.delivery.options.trim_start.value() == 2
    assert entry.native.profile_combo.currentText() == "medium"
    install_translator(qapp, "zh_CN")
    qapp.processEvents()
    assert entry.method.combo.currentData() == "reels"
    assert "竖屏视频交付" in entry.method.combo.currentText()
    entry.toggle_guide()
    assert entry.delivery.help_button.isChecked()


@pytest.mark.parametrize("mode", [0, 1])
def test_single_and_batch_layouts_fit_small_windows(gui_window_factory, qapp, mode):
    install_translator(qapp, "zh_CN")
    window = gui_window_factory()
    window.resize(980, 640)
    window.show()
    for route, index in (("Run", 0), ("Batch", 1)):
        window._navigate_to(route)
        screen = window.stack.widget(index)
        screen.method.combo.setCurrentIndex(mode)
        qapp.processEvents()
        assert window.width() == 980
        assert window.height() == 640
        assert screen.method.isVisible()
        if route == "Batch":
            screen.tabs.setCurrentIndex(1)
            qapp.processEvents()
            assert screen.settings.currentIndex() == mode
        top = screen.method.mapTo(window, screen.method.rect().topLeft())
        bottom = screen.method.mapTo(window, screen.method.rect().bottomRight())
        assert window.rect().contains(top) and window.rect().contains(bottom)


def test_shutdown_stops_both_single_processing_modes(gui_window_factory, monkeypatch):
    screen = gui_window_factory().stack.widget(0)
    native = Mock(return_value=False)
    delivery = Mock(return_value=True)
    monkeypatch.setattr(screen.native, "shutdown_workers", native)
    monkeypatch.setattr(screen.delivery, "shutdown_workers", delivery)
    assert not screen.shutdown_workers(12)
    native.assert_called_once_with(12)
    delivery.assert_called_once_with(12)


def test_delivery_task_remains_visible_in_activity_banner(gui_window_factory):
    window = gui_window_factory()
    screen = window.stack.widget(0)
    screen.delivery.worker = Mock()
    screen.delivery.feedback.setText("Encoding")
    screen.delivery.progress_bar.setValue(420)
    try:
        window._navigate_to("History")
        window._refresh_activity()
        assert not window.activity_banner.isHidden()
        assert window.activity_banner.progress.value() == 420
    finally:
        screen.delivery.worker = None


def test_history_reopens_persisted_report_and_aligned_comparison(qtbot, completed):
    entry, _report = completed
    state = AppState()
    state.push_history(entry)
    screen = HistoryScreen(AppState())  # reload from disk, not the active delivery screen
    qtbot.addWidget(screen)
    actions = screen.table.cellWidget(0, 6)
    assert not screen.compare_btn.isEnabled()
    screen.table.selectRow(0)
    assert screen.compare_btn.isEnabled() and screen.report_btn.isEnabled()
    screen.report_btn.click()
    assert isinstance(screen._report_dialog, DeliveryReportDialog)
    assert screen._report_dialog._report["source"]["filename"] == "original.mp4"
    actions.findChild(QPushButton, "history_compare").click()
    assert screen._compare_dialog is not None
    assert screen._compare_dialog._source_range == (1000, 10000)
    screen._play_path(entry.output_path)
    assert screen._compare_dialog._paths[0] is None
    screen.close()
    assert not screen._compare_dialog.isVisible()
    assert not screen._report_dialog.isVisible()


def test_history_legacy_video_and_html_report_stay_in_app(qtbot, completed, tmp_path):
    entry, _report = completed
    (Path(entry.output_path).parent / "report.json").unlink()
    html = tmp_path / "old.qa.html"
    html.write_text("<h1>Quality</h1><table><tr><td>VMAF</td><td>95</td></tr></table>")
    entry.qa_html_path = str(html)
    screen = HistoryScreen(AppState())
    qtbot.addWidget(screen)
    screen._open_comparison(entry)
    assert screen._compare_dialog._source_range is None
    screen._open_report(entry)
    assert "VMAF" in screen._report_dialog.findChild(QTextBrowser).toPlainText()
    screen.close()


def test_history_preserves_a_comparison_until_frame_worker_stops(qtbot, completed, monkeypatch):
    entry, _report = completed
    screen = HistoryScreen(AppState())
    qtbot.addWidget(screen)
    screen._open_comparison(entry)
    original = screen._compare_dialog
    with monkeypatch.context() as patch:
        patch.setattr(original, "close", lambda: False)
        screen._open_comparison(entry)
        assert screen._compare_dialog is original
        assert not screen.shutdown_workers()
    assert screen.shutdown_workers()


@pytest.mark.parametrize("contents", [None, "bad json", "[]", '{"source": []}'])
def test_history_handles_unavailable_reports(qtbot, completed, monkeypatch, contents):
    entry, _report = completed
    path = Path(entry.output_path).parent / "report.json"
    if contents is None:
        path.unlink()
    else:
        path.write_text(contents)
    warning = Mock()
    monkeypatch.setattr(QMessageBox, "warning", warning)
    screen = HistoryScreen(AppState())
    qtbot.addWidget(screen)
    screen._open_report(entry)
    assert screen._report_dialog is None
    warning.assert_called_once()
    screen.close()


@pytest.mark.parametrize("which", ["source_path", "output_path"])
def test_history_reports_missing_video(qtbot, completed, monkeypatch, which):
    entry, _report = completed
    Path(getattr(entry, which)).unlink()
    warning = Mock()
    monkeypatch.setattr(QMessageBox, "warning", warning)
    screen = HistoryScreen(AppState())
    qtbot.addWidget(screen)
    screen._open_comparison(entry)
    assert screen._compare_dialog is None
    warning.assert_called_once()


def test_batch_defaults_to_delivery_and_writes_reviewable_history(
    qtbot, qapp, monkeypatch, completed, tmp_path,
):
    entry, report = completed
    monkeypatch.setattr(ReelsBatchWorker, "start", lambda self: None)
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.input_dir, screen.output_dir = tmp_path, tmp_path / "exports"
    screen._refresh_preview()
    screen._refresh_run_btn()
    assert screen.method.combo.currentData() == "reels"
    screen.reels_options.trim_start.setValue(1)
    screen._start_batch([Path(entry.source_path)])
    worker = screen.worker
    assert isinstance(worker, ReelsBatchWorker)
    assert worker.rules.scenes.trim_start_sec == 1
    assert not screen.method.isEnabled() and not screen.settings.isEnabled()
    install_translator(qapp, "zh_CN")
    worker.progress.emit(0.2, "processing")
    assert screen.status_label.text() == "正在编码视频"
    install_translator(qapp, "en_US")
    monkeypatch.setattr(worker, "_execute", lambda: {
        "directory": Path(entry.output_path).parent, "report": report,
    })
    worker.run()
    assert screen.worker is None and screen.method.isEnabled()
    assert screen.progress_bar.value() == 1
    assert "Failed: 0" in screen.status_label.text()
    history = AppState().history
    assert len(history) == 1 and history[0].output_path == entry.output_path
    with qtbot.waitSignal(screen.navigate_requested) as signal:
        screen.history_btn.click()
    assert signal.args == ["History"]


def test_batch_original_method_still_uses_existing_worker(qtbot, monkeypatch, tmp_path):
    from video_uniquifier.gui.workers.batch_worker import BatchWorker

    monkeypatch.setattr(BatchWorker, "start", lambda self: None)
    source = tmp_path / "source.mp4"
    source.touch()
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.input_dir, screen.output_dir = tmp_path, tmp_path / "exports"
    screen.method.combo.setCurrentIndex(1)
    screen._start_batch([source])
    assert isinstance(screen.worker, BatchWorker)
    assert screen.worker.profile.name == "soft"
    screen._on_done({})


def test_batch_video_actions_use_the_native_player(qtbot, completed, monkeypatch):
    entry, _report = completed
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.table.open_requested.emit(entry.output_path)
    original = screen._player
    assert original is not None and original._paths == [None, Path(entry.output_path)]
    with monkeypatch.context() as patch:
        patch.setattr(original, "close", lambda: False)
        screen._play_video(entry.output_path)
        assert screen._player is original
        assert not screen.shutdown_workers()
    screen._play_video(entry.output_path)
    assert screen._player is not original
    assert screen.shutdown_workers()
    warning = Mock()
    monkeypatch.setattr(QMessageBox, "warning", warning)
    screen._play_video(entry.output_path + ".missing")
    warning.assert_called_once()


def test_batch_rejects_invalid_rules_before_start(qtbot, monkeypatch, tmp_path):
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.input_dir = screen.output_dir = tmp_path
    screen.reels_options.title_group.setChecked(True)
    screen.reels_options.title_text.setPlainText("")
    error = Mock()
    monkeypatch.setattr(QMessageBox, "critical", error)
    screen._start_batch([tmp_path / "source.mp4"])
    error.assert_called_once()
    assert screen.worker is None and screen.tabs.currentIndex() == 1


def test_batch_worker_snapshots_files_rules_and_stages_assets(qapp, monkeypatch, tmp_path):
    files = [tmp_path / "a.mp4", tmp_path / "b.mp4"]
    font = tmp_path / "font.ttf"
    font.write_bytes(b"font")
    rules = ReelsRules()
    worker = ReelsBatchWorker(files, rules, tmp_path, assets={"font.ttf": font})
    files.clear()
    rules.video.crf = 18
    calls = []

    def process(source, effective, root, *, asset_root, **kwargs):
        assert (asset_root / "font.ttf").read_bytes() == b"font"
        assert effective.video.crf == 21
        directory = root / "results" / source.stem
        directory.mkdir(parents=True)
        (directory / "report.json").write_text('{"plan_hash": "valid"}')
        calls.append(source)
        return directory

    monkeypatch.setattr(reels_worker, "process_video", process)
    results = []
    done = []
    worker.item_completed.connect(lambda source, payload: results.append((source, payload)))
    worker.finished_ok.connect(done.append)
    worker.run()
    assert [source.name for source in calls] == ["a.mp4", "b.mp4"]
    assert len(results) == 2
    assert done == [{"completed": 2, "failed": 0}]


def test_batch_cancellation_restores_controls_and_marks_interrupted_file(
    qtbot, tmp_path, monkeypatch,
):
    source = tmp_path / "source.mp4"
    source.touch()
    monkeypatch.setattr(ReelsBatchWorker, "start", lambda self: None)
    screen = BatchScreen(AppState())
    qtbot.addWidget(screen)
    screen.input_dir = screen.output_dir = tmp_path
    screen._refresh_preview()
    screen._start_batch([source])
    worker = screen.worker

    def interrupted():
        raise ReelsError("cancelled", "cancelled")

    monkeypatch.setattr(worker, "_execute", interrupted)
    worker.run()
    row = screen.table.find_key(str(source))
    assert screen.table.item(row, 1).data(STATUS_ROLE) == "cancelled"
    assert screen.worker is None and screen.method.isEnabled()
    assert screen.status_label.text() == "Cancelled"
    assert screen.state.history == []


@pytest.mark.parametrize("continue_on_error", [True, False])
def test_batch_failure_policy(qapp, monkeypatch, tmp_path, continue_on_error):
    worker = ReelsBatchWorker([tmp_path / "bad.mp4", tmp_path / "good.mp4"], ReelsRules(),
                              tmp_path, continue_on_error=continue_on_error)
    calls = []

    def execute():
        calls.append(worker.source.name)
        if worker.source.name == "bad.mp4":
            raise ReelsError("quality_failed", "QA failed")
        return {"directory": tmp_path, "report": {}}

    monkeypatch.setattr(worker, "_execute", execute)
    done, errors, failures = [], [], []
    worker.finished_ok.connect(done.append)
    worker.failed.connect(errors.append)
    worker.file_failed.connect(lambda path, message: failures.append((path, message)))
    worker.run()
    assert len(failures) == 1
    assert len(calls) == (2 if continue_on_error else 1)
    assert done == ([{"completed": 1, "failed": 1}] if continue_on_error else [])
    assert errors == ([] if continue_on_error else ["QA failed"])


@pytest.mark.parametrize("when", ["before", "during", "after_publish", "last_publish"])
def test_batch_cancellation_retains_only_published_results(qapp, monkeypatch, tmp_path, when):
    files = [tmp_path / "one.mp4", tmp_path / "two.mp4"]
    worker = ReelsBatchWorker(files, ReelsRules(), tmp_path)
    published, cancelled, done = [], [], []

    def execute():
        if when != "last_publish" or worker.source == files[-1]:
            worker.request_cancel()
        if when == "during":
            raise ReelsError("cancelled", "cancelled")
        return {"directory": tmp_path, "report": {}}

    monkeypatch.setattr(worker, "_execute", execute)
    worker.item_completed.connect(lambda path, payload: published.append(path))
    worker.cancelled.connect(lambda: cancelled.append(True))
    worker.finished_ok.connect(done.append)
    if when == "before":
        worker.request_cancel()
    worker.run()
    assert len(published) == {"before": 0, "during": 0, "after_publish": 1, "last_publish": 2}[when]
    assert cancelled == [True] and done == []


@pytest.mark.parametrize("contents", [None, "{}", "[]", "bad", '{"locale": "unknown"}'])
def test_chinese_is_the_default_boot_language(monkeypatch, tmp_path, contents):
    path = tmp_path / "boot.json"
    monkeypatch.setattr("video_uniquifier.gui.state.STATE_PATH", path)
    monkeypatch.setenv("LANG", "en_US.UTF-8")
    if contents is not None:
        path.write_text(contents)
    assert _resolve_boot_locale() == "zh_CN"


@pytest.mark.parametrize("locale", ["en_US", "ru_RU", "zh_CN"])
def test_explicit_language_preference_is_preserved(monkeypatch, tmp_path, locale):
    path = tmp_path / "boot.json"
    path.write_text(json.dumps({"locale": locale}))
    monkeypatch.setattr("video_uniquifier.gui.state.STATE_PATH", path)
    assert _resolve_boot_locale() == locale
    assert AppState().locale == locale


def test_fresh_app_state_defaults_to_chinese():
    assert AppState().locale == "zh_CN"
