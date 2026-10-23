"""Single-video entry point selecting between existing processing workflows."""

from PyQt6.QtWidgets import QSizePolicy, QStackedWidget, QVBoxLayout

from video_uniquifier.gui.design import Space
from video_uniquifier.gui.screens.base import ScreenBase
from video_uniquifier.gui.screens.reels import ReelsScreen
from video_uniquifier.gui.screens.run import RunScreen
from video_uniquifier.gui.state import AppState
from video_uniquifier.gui.widgets.processing_method import ProcessingMethod


class ProcessingScreen(ScreenBase):
    def __init__(self, state: AppState) -> None:
        super().__init__(state)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.method = ProcessingMethod()
        self.method.setContentsMargins(Space.PAGE, Space.MD, Space.PAGE, 0)
        layout.addWidget(self.method)
        self.workflows = QStackedWidget()
        self.workflows.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Ignored)
        self.delivery = ReelsScreen(state)
        self.native = RunScreen(state)
        for screen in (self.delivery, self.native):
            screen.navigate_requested.connect(self.navigate_requested)
            self.workflows.addWidget(screen)
        layout.addWidget(self.workflows, stretch=1)
        self.method.combo.currentIndexChanged.connect(self.workflows.setCurrentIndex)

    def toggle_guide(self) -> None:
        screen = self.workflows.currentWidget()
        if isinstance(screen, ScreenBase):
            screen.toggle_guide()

    def shutdown_workers(self, wait_ms: int = 16000) -> bool:
        delivery_stopped = self.delivery.shutdown_workers(wait_ms)
        native_stopped = self.native.shutdown_workers(wait_ms)
        return delivery_stopped and native_stopped
