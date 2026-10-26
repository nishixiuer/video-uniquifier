# 本地帖子与 Facebook 发布

迁移参考：`/Users/zhangyilan/www/media-share` 中的 `ContentGenerationService`、
`AiContentGenerator`、`FacebookPublishScheduler`、`OfficialFacebookClient` 和
`OfficialFacebookPublisher`。不修改源项目，不连接其 MySQL，不读取原项目密钥。

帖子保存文案、标签、语种、媒体和审核状态。模板批量生成与可选的 AI 文案生成
均先产生待审核帖子。只有已审核帖子能加入发布任务。

发布任务保存不可变帖子快照；原项目的“一个内容仅分配一个发布任务”约束
保留在本地。主页规则按标签选取已审核、未占用内容，检查滚动 24 小时额度、
最小间隔和本机时间窗口。定时器仅在应用运行时执行；重启继续待执行任务，
中途断开的最终提交标为待核实，避免盲目重复发送。

本地文件导入应用数据目录，发布时直接上传 Meta；不需要公网素材 URL。
App Secret、用户/Page Token 和 AI Key 使用 Electron safeStorage 加密，
不传回界面、不写入普通配置或任务日志。系统不提供安全加密时拒绝保存密钥。
单机版需用户自己的 Meta App；不在安装包内嵌共享 App Secret。

官方接口参考（实现时核对）：

- [Pages API 发帖](https://developers.facebook.com/docs/pages-api/posts/)
- [Facebook Login 手动授权流程](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
- [Reels Publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing/)
- [Meta Reels 官方示例](https://github.com/fbsamples/reels_publishing_apis)

OAuth 使用系统浏览器和带随机 state 的本机回调；配置的回调 URI 必须与 Meta
应用中的 Valid OAuth Redirect URIs 完全一致。HTTP localhost 的可用性取决于
Meta 应用类型与开发设置；也支持粘贴已登记 HTTPS 回调的完整返回 URL。
请求权限仅用于主页列表和发帖：pages_show_list、pages_read_engagement、
pages_manage_posts。应用上线和非角色用户使用通常需要 Meta 审核/高级访问权限；
软件无法代替 Meta 开通权限。仅支持官方允许的 Page 发帖，不发布到个人时间线。

AI 接口可填写 OpenAI 兼容的 Base URL、模型和 API Key。使用 AI 时会向该接口
发送输入的产品/剧情资料及模板；默认仅发送文字，不上传本地图片或视频。
模板变量：{title}、{description}、{language}、{tags}、{index}。

首次设置：

1. “帖子内容 → 批量生成 → 配置 AI”：填写 Base URL（如 `https://你的接口/v1`）、模型与 API Key；本机模型允许 `http://127.0.0.1:端口/v1`。也可选“本地模板”离线生成。
2. “主页授权”：填写自己的 App ID、App Secret、API 版本和回调地址，先保存配置。默认本机回调为 `http://localhost:47135/facebook/callback`，只监听 `127.0.0.1`。平台不接受本机回调时，登记自己的 HTTPS 地址，授权后粘贴完整回调 URL。每次授权使用一次性 state，10 分钟过期。
3. 点击“打开 Facebook 官方授权”，在浏览器选择自己拥有发布权限的主页。应用交换长期用户令牌并读取主页令牌；也可导入自己应用的用户令牌，仍会校验权限和同步主页。
4. 在“帖子内容”手动创建或批量生成文字、图片或单视频帖子；生成结果先待审核。可选择视频工作区已完成的成片，预览通过后审核。
5. “安排发布”可选主页帖子或 Reels，并设定本机时间；立即发布也先进入任务队列。“主页授权 → 发布规则”可启用按标签挑选、额度、间隔和时间窗口的自动发帖。

| 状态 | 含义与操作 |
| --- | --- |
| 待发布 | 等待本机计划时间，可取消；暂停调度后保持等待 |
| 上传并发布中 | 已开始请求 Meta；暂停调度不会中断当前上传 |
| 平台处理中 | 已获得视频编号，轮询 Meta 转码/发布状态，不重复上传 |
| 已发布 | 远端已确认，可打开官方帖子链接 |
| 发布失败 | 已确认拒绝或发布前失败，修正原因后可手动重试，最多 3 次 |
| 需核实发布结果 | 最终请求断线、应用中断或查询超时；有编号可“核实结果”，没有编号需到主页核对，不能直接重发 |
| 已取消 | 尚未发出或本地断开连接时取消，不撤销已发布帖子 |

自动规则使用滚动 24 小时额度，`0` 表示不限制数量；跨午夜时间窗口受支持。
全局暂停状态、草稿和任务会随重启恢复。关闭应用、电脑睡眠期间无法准点执行，
恢复运行后执行已到期的待发布任务；自动选稿仍检查当前时间窗口。
每条帖子只能分配一个未取消发布任务，多个主页不会同时占用同一条内容。

验证使用模拟 Graph/AI 接口与临时数据目录，不读取个人凭据或真实发布。
`pnpm test` 覆盖授权、接口错误、媒体上传、规则与任务恢复；
`pnpm exec vitest run --coverage --coverage.include='src/publishing/*.ts' --coverage.exclude='src/publishing/*.test.ts'`
可查看本模块覆盖率。`pnpm test:e2e` 覆盖真实 Electron 页面、主进程 AI 调用、
系统加密与重启恢复。真实 Meta 联调需用户配置自己的应用与主页。
