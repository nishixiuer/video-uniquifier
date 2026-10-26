# Electron 桌面端

独立的 **Electron + React + Ant Design + Tailwind CSS** 工程，保留仓库原有
Python 核心、CLI 和 PyQt 桌面端。所有新增代码都放在本目录。

## 开发启动

在仓库根目录已有 `.venv` 的情况下：

```bash
cd desktop-electron
pnpm install
pnpm dev
```

React/CSS 修改由 Vite 热更新，**无需重编译 Python、无需重新打包应用**。
主进程和 preload 修改会由 electron-vite 重新载入。开发模式直接调用
`../.venv/bin/python`；可用环境变量 `VIDEO_UNIQ_PYTHON` 指定其他 Python。
需要原项目的核心与 `scene` 依赖，以及 PATH 中的 `ffmpeg`、`ffprobe`。

## 功能入口

| 页面 | 功能 | 复用的 Python 接口 |
| --- | --- | --- |
| 素材库 | 保存视频及剧情/推广资料、分类标签；多选发起制作，来源启停 | 核心 `probe` 读取真实元数据 |
| 批量制作 | 连续/均匀选段、真实剪片与逐素材 AI 文案；持久化批次、部分失败重试 | `ReelsRules` / `process_video` / 既有任务与报告 |
| 内容库 | 成片与文案统一入库，来源/标签/审核/发布筛选；内置对比、参数和质量报告 | 原视频处理任务及报告 |
| 视频处理 | 默认短剧交付、切换通用处理；检查、样片、完整导出 | Reels `inspect_source` / `prepare_plan` / `process_video`；`build_plan` / `run_full` |
| 短剧制作 | 工作区独立子路由；分步配置分辨率、裁切、响度、标题、Logo | `ReelsRules` / `PackagingRules` |
| 批量处理 | 文件夹、子目录、筛选、多选；统一设置后按序处理 | 与单视频共用任务适配器 |
| 处理队列 | 后台任务取消、通用处理暂停/继续、失败重试；目录队列管理 | `CancelToken` / `PauseToken` / `FileQueue` |
| 历史记录 | 成片定位、同步对比、质量报告；导入旧版 `history.json` | 本地持久化任务及原报告 |
| 质量报告 | 可读的检查项目列表；重新计算原片/成片质量 | `qa.report.build_report` |
| 处理配置 | 内置/自定义配置、导入 YAML、校验、保存副本；默认交付规则 | `load_profile` / `load_rules` / Pydantic Schema |
| 自动调参 | 有界搜索、逐次指标、自定义配置保存 | `calibration.loop.calibrate`（Chromaprint，无 AI 模型） |
| 参考素材库 | 视频指纹入库、查看、移除索引 | `qa.corpus.Corpus` |
| 实验版本 | 多个独立版本及其质量报告 | `run_full`，每版新种子 |
| 文案工具 | 补充的手动编辑、图片/文字和模板/AI 文案生成 | 本机发布服务，不依赖 Python |
| 主页授权 | 官方 OAuth、主页同步、逐主页自动发帖规则 | Facebook Graph API |
| 发布任务 | 立即/定时发布文字、图片、视频和 Reels；暂停、取消、失败重试与远端状态核实 | 本机持久化调度器 + 官方上传 API |
| 服务配置 | Meta 应用、AI 文案接口、提示词模板；可开关 Yerd 本机域名回调映射 | 本机发布服务 |
| 设置 | 默认中文、深浅主题、默认处理方式、减少动效、工具检测 | Electron 本地偏好存储 |

默认进入素材库，主导航按“素材库 → 批量制作 → 内容库 → 主页规则/发布任务”组织。
独立视频工具采用“导入素材 → 处理参数 → 画面包装/样片 → 检查与导出”的布局。
切换路由保留编辑草稿，所有处理任务独立于页面生命周期。
左侧导航支持分组展开/收起和整体收窄为图标，并记住状态；服务配置和设置固定在底部。
帖子生成页跳转到服务配置后再返回，已填写的资料、选中的素材和当前标签页会保留。
对比窗口使用内置 HTML 视频组件和共同播放控制器，不会调用系统播放器。
裁切后的成片会按源片时间偏移对齐；只播放成片声音，避免两路音频叠加。
“视频对比”和“质量报告”均提供“参数对比”，并排显示原片与成片的分辨率、
帧率、时长、编码、码率、文件大小及音频参数，并标记变化。优先读取历史报告
中的实测值；通用处理及旧报告缺少元数据时，调用原核心 probe 读取本地文件。
未测量值和无音轨分别标注，文件失效不会阻止查看其他可用参数。

## 架构

```text
React / Ant Design / Tailwind
       ↓ 受限 preload API
Electron 主进程（文件选择、媒体流、路径授权、引擎生命周期）
       ↓ stdin / stdout JSON 协议
Python desktop_engine（任务适配、状态持久化）
       ↓
原有 video_uniquifier.core（处理、配置校验、质量检查）
```

视频处理不启动 HTTP 服务，也不将视频读取为大块 JSON/base64。
仅将本地文件路径传给引擎。主进程只允许访问选择器授权或任务生成的文件。
媒体使用受限 `media://` 协议播放，支持视频流式读取和拖动定位。

内容与发布为独立的本机模块，配置、帖子、素材副本和任务保存在
`userData/publishing`，无需 Laravel、MySQL、Redis 或云存储。
用户安排发布或启用自动发帖后，才向 Meta 上传对应素材；AI 模式仅向配置的
接口发送填写的文字资料。OAuth 授权时可临时启动仅监听本机的回调端口。
App Secret、访问令牌与 AI 密钥经系统安全存储加密，界面只接收是否已配置。

首次使用：在侧栏底部的“服务配置”填写自己的 Meta 应用，以及兼容 Chat Completions
的 AI 接口、模型及密钥（也可选本地模板）；在“主页授权”完成官方授权。
在“素材库”导入视频并补全资料，经“批量制作”自动剪片和生成文案；到“内容库”审核，
再为主页设置标签、额度、间隔和时间窗口，或手动安排发布。业务流程见 [PRODUCTION.md](PRODUCTION.md)。
本机定时发布需要应用保持运行。详细授权设置和状态说明见 [PUBLISHING.md](PUBLISHING.md)。

应用数据存放在 Electron `userData/engine` 中，任务记录保存实际路径而非
临时端口 URL，因此重启后仍能访问。退出时通过关闭 stdin 通知 Python
取消任务，等待 FFmpeg 子进程收尾。

## 打包

先在项目 Python 环境安装 PyInstaller，例如：

```bash
uv pip install --python ../.venv/bin/python 'pyinstaller>=6.16,<7'
pnpm package
```

`pnpm package` 先构建 Python 运行时，再构建前端和桌面安装包：

- Python 以 PyInstaller onedir 形式包含解释器、核心依赖、配置、模板、FFmpeg/FFprobe 及其动态库。
- 不包含 PyQt 和 Torch，不要求最终用户安装 Python。
- 镜头检测使用原项目的独立子进程；冻结入口支持原有 `-m ...scene_worker` 调用。
- 运行时会按源码、依赖版本和媒体工具生成指纹。只改 UI 时复用已打包 Python；需要时可执行 `pnpm package:python --force`。
- 构建产物在 `release/`。macOS 默认生成供本机测试的未签名包；正式分发时单独配置签名。
- Windows/Linux 应在对应平台构建和验证，不能直接使用 macOS 的 Python/FFmpeg 运行时。

`pnpm build` 只编译前端与 Electron 代码；`pnpm package:python` 只构建 Python。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
pnpm test:e2e
```

Python 测试覆盖配置、任务生命周期、输出保护、取消/重试、暂停/继续、
预检/样片、批处理适配、报告、调参、参考库、目录队列与旧历史导入，包含
实际 FFmpeg 处理。已构建运行时时，还会在移除项目 Python/FFmpeg PATH
的环境中检查独立运行时。

Playwright 直接启动 Electron，验证全部中文导航、选片预览、真实导出、
同步播放、列表报告和重启恢复。macOS `.app` 打包后可进一步验证：

```bash
VIDEO_UNIQ_TEST_PACKAGED=1 pnpm test:e2e
```

UI 截图保存在 `screenshots/`。
