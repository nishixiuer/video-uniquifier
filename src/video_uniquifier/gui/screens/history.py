"""History — past runs with re-open / re-run actions."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QTableWidgetItem,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from video_uniquifier.gui.a11y import mark
from video_uniquifier.gui.screens.base import ScreenBase
from video_uniquifier.gui.state import AppState, HistoryEntry
from video_uniquifier.gui.widgets.delivery_report import DeliveryReportDialog
from video_uniquifier.gui.widgets.studio_preview import StudioPreview
from video_uniquifier.gui.widgets.studio_table import StudioTable, TableTools
from video_uniquifier.gui.widgets.video_compare import VideoCompareDialog


class HistoryScreen(ScreenBase):
    def __init__(self, state: AppState) -> None:
        super().__init__(state)
        self._all_entries: list[HistoryEntry] = []
        self._compare_dialog: VideoCompareDialog | None = None
        self._report_dialog: QDialog | None = None
        self._build_ui()
        self.state.history_changed.connect(self._on_history_changed)
        self._on_history_changed(self.state.history)

    def _build_ui(self) -> None:
        layout = self.page_layout(
            'History',
            'Find completed jobs, open their videos and revisit quality reports.',
        )

        self.table = StudioTable(7, self.state, "history.header", 4)
        self.table.set_headers([
            "Date", "Source", "Profile", "Encoder",
            "Status", "Output", "Actions",
        ])
        self.table.sortItems(0, Qt.SortOrder.DescendingOrder)
        self.table.restore_header()
        self.table.header.resizeSection(6, 300)
        self.table.open_requested.disconnect()
        self.table.open_requested.connect(self._play_path)
        self.table_tools = TableTools(self.table, filter_rows=False)
        self.filter_edit = self.table_tools.search
        self.filter_edit.textChanged.connect(self._refresh)
        self.table_tools.status.currentIndexChanged.connect(self._refresh)
        layout.addWidget(self.table_tools)
        layout.addWidget(self.table, stretch=1)
        self.clear_btn = QPushButton(self.tr("&Clear all"))
        self.clear_btn.clicked.connect(self._clear_history)
        mark(self.clear_btn, "Clear history", "Remove history records after confirmation.")
        controls = QHBoxLayout()
        self.compare_btn = QPushButton(self.tr("Video comparison"))
        self.report_btn = QPushButton(self.tr("Quality report"))
        self.compare_btn.setAccessibleName(self.tr("Video comparison"))
        self.report_btn.setAccessibleName(self.tr("Quality report"))
        self.compare_btn.clicked.connect(self._compare_selected)
        self.report_btn.clicked.connect(self._report_selected)
        controls.addWidget(self.compare_btn)
        controls.addWidget(self.report_btn)
        self.table.itemSelectionChanged.connect(self._refresh_review_actions)
        controls.addStretch(1)
        controls.addWidget(self.clear_btn)
        self.add_action_bar(controls)
        self.empty_label = QLabel(self.tr(
            "No matching jobs. Process a video or change the search to find previous results.",
        ))
        self.empty_label.setObjectName("hint")
        self.empty_label.setWordWrap(True)
        layout.addWidget(self.empty_label)

    def _on_history_changed(self, entries: list[HistoryEntry]) -> None:
        self._all_entries = list(entries)
        self._refresh()

    def _refresh(self) -> None:
        filter_text = self.filter_edit.text().casefold().strip()
        status = self.table_tools.status.currentData()
        with self.table.updating():
            self.table.setRowCount(0)
            for entry in self._all_entries:
                haystack = " ".join([
                    entry.source_path, entry.output_path, entry.profile_name,
                    entry.encoder_name, entry.status, entry.timestamp,
                    self.table.status_item(entry.status).text(),
                ]).casefold()
                if filter_text and filter_text not in haystack:
                    continue
                if status and entry.status != status:
                    continue
                self._append_row(entry)
        self.empty_label.setVisible(self.table.rowCount() == 0)
        self._refresh_review_actions()

    def _selected_entry(self) -> HistoryEntry | None:
        keys = self.table.selected_keys()
        if len(keys) != 1:
            return None
        return next((
            entry for entry in self._all_entries
            if f"{entry.timestamp}|{entry.plan_hash}|{entry.output_path}" == keys[0]
        ), None)

    def _refresh_review_actions(self) -> None:
        entry = self._selected_entry()
        ready = entry is not None and entry.status == "done"
        self.compare_btn.setEnabled(ready)
        self.report_btn.setEnabled(ready)

    def _compare_selected(self) -> None:
        entry = self._selected_entry()
        if entry is not None:
            self._open_comparison(entry)

    def _report_selected(self) -> None:
        entry = self._selected_entry()
        if entry is not None:
            self._open_report(entry)

    def _append_row(self, entry: HistoryEntry) -> None:
        r = self.table.rowCount()
        self.table.insertRow(r)
        key = f"{entry.timestamp}|{entry.plan_hash}|{entry.output_path}"
        self.table.setItem(r, 0, self.table.file_item(entry.timestamp, key, entry.output_path))
        source = self.table.path_item(entry.source_path)
        source.setText(Path(entry.source_path).name)
        self.table.setItem(r, 1, source)
        self.table.setItem(r, 2, QTableWidgetItem(entry.profile_name))
        self.table.setItem(r, 3, QTableWidgetItem(entry.encoder_name))
        self.table.setItem(r, 4, self.table.status_item(entry.status))
        self.table.setItem(r, 5, self.table.path_item(entry.output_path))

        # Actions cell
        actions_widget = self._build_actions(entry)
        self.table.setCellWidget(r, 6, actions_widget)

    def _build_actions(self, entry: HistoryEntry) -> QWidget:
        w = self.table.row_actions(entry.output_path)
        h = w.layout()
        if isinstance(h, QHBoxLayout):
            compare = QPushButton(self.tr("Video comparison"))
            compare.setAccessibleName(self.tr("Video comparison"))
            compare.setObjectName("history_compare")
            compare.clicked.connect(lambda: self._open_comparison(entry))
            compare.setEnabled(entry.status == "done")
            h.insertWidget(2, compare)
            report = QPushButton(self.tr("Quality report"))
            report.setAccessibleName(self.tr("Quality report"))
            report.setObjectName("history_report")
            report.clicked.connect(lambda: self._open_report(entry))
            report.setEnabled(entry.status == "done")
            h.insertWidget(3, report)
        return w

    @staticmethod
    def _delivery_report_path(entry: HistoryEntry) -> Path:
        return Path(entry.output_path).parent / "report.json"

    def _pause_previews(self) -> None:
        window = self.window() or self
        for preview in window.findChildren(StudioPreview):
            preview.pause()
        for dialog in window.findChildren(VideoCompareDialog):
            dialog.pause()

    def _play_path(self, path: str) -> None:
        self._show_comparison(None, Path(path))

    def _open_comparison(self, entry: HistoryEntry) -> None:
        source_range: tuple[float, float] | None = None
        report_path = self._delivery_report_path(entry)
        if report_path.is_file():
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
                scenes = report["effective_rules"]["scenes"]
                start = float(scenes["trim_start_sec"])
                end = float(report["source"]["duration_sec"]) - float(scenes["trim_end_sec"])
                if math.isfinite(start) and math.isfinite(end) and 0 <= start < end:
                    source_range = (start, end)
            except (OSError, ValueError, TypeError, KeyError):
                pass  # Legacy reports have no delivery trim metadata.
        self._show_comparison(Path(entry.source_path), Path(entry.output_path), source_range)

    def _show_comparison(self, source: Path | None, output: Path,
                         source_range: tuple[float, float] | None = None) -> None:
        if not output.is_file() or (source is not None and not source.is_file()):
            QMessageBox.warning(self, self.tr("File unavailable"), self.tr(
                "Video file is unavailable. Check that the original and export still exist.",
            ))
            return
        self._pause_previews()
        if self._compare_dialog is not None:
            if not self._compare_dialog.close():
                return
            self._compare_dialog.deleteLater()
        dialog = VideoCompareDialog(source, output, source_range=source_range, parent=self)
        dialog.wipe.set_theme(self.state.theme)
        self.state.theme_changed.connect(dialog.wipe.set_theme)
        self._compare_dialog = dialog
        dialog.show()

    def _open_report(self, entry: HistoryEntry) -> None:
        dialog: QDialog
        try:
            if entry.qa_html_path:
                html = Path(entry.qa_html_path).read_text(encoding="utf-8")
                dialog = QDialog(self)
                dialog.setWindowTitle(self.tr("Quality report"))
                dialog.resize(900, 700)
                browser = QTextBrowser()
                browser.setHtml(html)
                QVBoxLayout(dialog).addWidget(browser)
            else:
                report = json.loads(self._delivery_report_path(entry).read_text(encoding="utf-8"))
                if (not isinstance(report, dict) or not isinstance(report.get("source"), dict)
                        or not isinstance(report.get("output"), dict)):
                    raise ValueError("Invalid delivery report")
                dialog = DeliveryReportDialog(report, parent=self)
        except (OSError, ValueError):
            QMessageBox.warning(self, self.tr("Quality report"), self.tr(
                "This job has no readable quality report. Check whether it was generated "
                "or moved from its export folder.",
            ))
            return
        self._pause_previews()
        if self._report_dialog is not None:
            self._report_dialog.close()
            self._report_dialog.deleteLater()
        self._report_dialog = dialog
        dialog.show()

    def shutdown_workers(self, wait_ms: int = 16000) -> bool:
        if self._compare_dialog is not None and not self._compare_dialog.close():
            return False
        if self._report_dialog is not None:
            self._report_dialog.close()
        return super().shutdown_workers(wait_ms)

    def _clear_history(self) -> None:
        if QMessageBox.question(
            self, "Clear history",
            "Remove all history entries? This cannot be undone.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        ) == QMessageBox.StandardButton.Yes:
            self.state.clear_history()

    def on_show(self) -> None:
        """Refresh whenever the user navigates here (catches background updates)."""
        self._on_history_changed(self.state.history)
