# Python runtime

开发模式直接调用仓库根目录的 `.venv`，因此修改 React/TypeScript 时不需要
重新编译 Python。发布桌面安装包时，`pnpm package` 会先运行
`python/build_runtime.py`，用 PyInstaller 把现有 Reels API 和处理引擎打成
自带解释器的 onedir 运行时，再由 electron-builder 放入应用资源目录。

```bash
cd desktop-electron
uv pip install --python ../.venv/bin/python 'pyinstaller>=6.16,<7'
pnpm package
```

`bridge.py` 只负责私有 stdin/stdout 通信和子进程入口；所有视频处理、配置校验、质量报告和
成片生成仍由 `video_uniquifier` 的 Python 核心完成。
