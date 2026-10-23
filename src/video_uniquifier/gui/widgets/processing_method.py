"""Shared processing-method picker; item data stays independent of translations."""

from PyQt6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from video_uniquifier.gui.design import Space


class ProcessingMethod(QWidget):
    def __init__(self) -> None:
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(Space.SM)
        row = QHBoxLayout()
        row.addWidget(QLabel(self.tr("Processing method")))
        self.combo = QComboBox()
        self.combo.addItem(self.tr("Vertical delivery · Facebook Reels"), "reels")
        self.combo.addItem(self.tr("Original processing · transform profiles"), "native")
        self.combo.setAccessibleName(self.tr("Processing method"))
        row.addWidget(self.combo, stretch=1)
        layout.addLayout(row)
        hint = QLabel(self.tr(
            "Reels prepares vertical video and dialogue loudness. "
            "Original processing uses soft, moderate or aggressive transforms.",
        ))
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        layout.addWidget(hint)
