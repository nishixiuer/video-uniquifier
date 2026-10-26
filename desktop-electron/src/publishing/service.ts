import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  AppConfig,
  CopyTemplate,
  FacebookPage,
  GenerationInput,
  Media,
  PageRule,
  Post,
  PublishingSnapshot,
  PublishTask,
} from "../shared/publishing";
import { defaultRule } from "../shared/publishing";
import { FacebookGraph, GraphError, type Fetch } from "./graph";

type State = Omit<PublishingSnapshot, "authorization" | "secureStorage">;
type Options = {
  root: string;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
  secure: () => boolean;
  allowed: (path: string) => string;
  open: (url: string) => Promise<void>;
  fetch?: Fetch;
  now?: () => number;
};
const text = (value: unknown, max = 10000): string => {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`文本字段无效或超过 ${max} 字符。`);
  return value.trim();
};
const tags = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error("标签必须是最多 50 项的列表。");
  return [...new Set(value.map((tag) => text(tag, 100)).filter(Boolean))];
};
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`数量必须在 ${min} 到 ${max} 之间。`);
  return value;
};
export function withinWindow(rule: PageRule, timestamp: number): boolean {
  const date = new Date(timestamp);
  const current = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return rule.start <= rule.end
    ? current >= rule.start && current <= rule.end
    : current >= rule.start || current <= rule.end;
}
export function renderTemplate(
  template: string,
  input: Pick<GenerationInput, "title" | "description" | "language" | "tags">,
  index: number,
): string {
  const values: Record<string, string> = {
    title: input.title,
    description: input.description,
    language: input.language,
    tags: input.tags.map((tag) => `#${tag.replace(/\s+/g, "_")}`).join(" "),
    index: String(index),
  };
  return template
    .replace(
      /\{(title|description|language|tags|index)\}/g,
      (_, key: string) => values[key],
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class PublishingService {
  private state: State;
  private encrypted: Record<string, string>;
  private authorization: PublishingSnapshot["authorization"] = {
    status: "idle",
    message: "尚未发起授权",
  };
  private oauth?: {
    state: string;
    expiresAt: number;
    claimed: boolean;
    config: AppConfig;
    secret: string;
  };
  private server?: Server;
  private authTimer?: ReturnType<typeof setTimeout>;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private closed = false;
  private generating = false;
  private connecting = false;
  private request: Fetch;
  private now: () => number;

  constructor(private options: Options) {
    mkdirSync(join(options.root, "media"), { recursive: true, mode: 0o700 });
    const path = join(options.root, "publishing.json");
    this.state = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : {
          posts: [],
          pages: [],
          tasks: [],
          templates: [
            {
              id: "default",
              name: "基础帖子",
              body: "{title}\n\n{description}\n\n{tags}",
            },
          ],
          app: {
            appId: "",
            version: "v26.0",
            redirectUri: "http://localhost:47135/facebook/callback",
            hasSecret: false,
          },
          ai: {
            baseUrl: "https://api.openai.com/v1",
            model: "",
            hasKey: false,
          },
          paused: false,
        };
    const secretPath = join(options.root, "credentials.enc.json");
    this.encrypted = existsSync(secretPath)
      ? JSON.parse(readFileSync(secretPath, "utf8"))
      : {};
    this.request = options.fetch || fetch;
    this.now = options.now || Date.now;
    for (const task of this.state.tasks) {
      if (task.status === "publishing") {
        task.status = "uncertain";
        task.error = "应用在发布过程中退出，请先核实远端结果，避免重复发布。";
      }
    }
    this.save();
  }
  private atomic(name: string, value: unknown) {
    const path = join(this.options.root, name);
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    renameSync(`${path}.tmp`, path);
  }
  private save() {
    this.atomic("publishing.json", this.state);
  }
  private secret(key: string) {
    if (!this.encrypted[key]) return "";
    try {
      return this.options.decrypt(this.encrypted[key]);
    } catch {
      throw new Error("无法解密本机凭据，请重新配置或授权。");
    }
  }
  private setSecret(key: string, value: string) {
    if (!this.options.secure())
      throw new Error(
        "系统安全存储不可用，无法保存密钥。请启用系统钥匙串/密码库后重试。",
      );
    this.encrypted[key] = this.options.encrypt(value);
    this.atomic("credentials.enc.json", this.encrypted);
  }
  private graph(config = this.state.app, secret = this.secret("appSecret")) {
    return new FacebookGraph(config, secret, this.request);
  }
  snapshot(): PublishingSnapshot {
    return structuredClone({
      ...this.state,
      authorization: this.authorization,
      secureStorage: this.options.secure(),
    });
  }
  start() {
    if (!this.timer)
      this.timer = setInterval(() => {
        void this.tick();
      }, 5_000);
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.stopOAuth();
  }
  private stopOAuth() {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.server?.close();
    this.server = undefined;
    this.oauth = undefined;
  }

  configureApp(input: Record<string, unknown>) {
    if (this.busy || this.oauth || this.connecting)
      throw new Error("请等待当前授权或发布完成后再修改应用配置。");
    const appId = text(input.appId, 100);
    if (!/^\d+$/.test(appId)) throw new Error("Meta App ID 必须是数字。");
    const version = text(input.version, 20);
    if (!/^v\d+\.0$/.test(version)) throw new Error("API 版本格式应为 v26.0。");
    const uri = new URL(text(input.redirectUri, 2048));
    if (
      uri.username ||
      uri.password ||
      uri.hash ||
      uri.search ||
      (uri.protocol !== "https:" &&
        !(
          uri.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(uri.hostname)
        ))
    )
      throw new Error(
        "回调地址必须为 HTTPS 或本机 HTTP localhost 地址，且不带查询参数。",
      );
    const changed = this.state.app.appId && this.state.app.appId !== appId;
    if (typeof input.secret === "string" && input.secret.trim())
      this.setSecret("appSecret", text(input.secret, 1024));
    else if (changed || !this.encrypted.appSecret)
      throw new Error("请输入当前应用的 App Secret。");
    if (changed)
      this.state.pages.forEach((page) => {
        page.connected = false;
      });
    this.state.app = {
      appId,
      version,
      redirectUri: uri.toString(),
      hasSecret: Boolean(this.encrypted.appSecret),
    };
    this.save();
  }
  configureAi(input: Record<string, unknown>) {
    const url = new URL(text(input.baseUrl, 2048));
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)
        ))
    )
      throw new Error("AI 地址应为 HTTPS，或本机模型服务的 HTTP 地址。");
    const model = text(input.model, 200);
    if (!model) throw new Error("请输入模型名称。");
    if (typeof input.key === "string" && input.key.trim())
      this.setSecret("aiKey", text(input.key, 2048));
    this.state.ai = {
      baseUrl: url.toString().replace(/\/$/, ""),
      model,
      hasKey: Boolean(this.encrypted.aiKey),
    };
    this.save();
  }

  async authorize() {
    if (this.busy || this.connecting)
      throw new Error("请等待当前发布或主页同步完成后再授权。");
    if (!this.state.app.appId || !this.state.app.hasSecret)
      throw new Error("请先配置 Meta 应用。");
    if (this.oauth?.claimed) throw new Error("正在完成授权，请稍候。");
    this.stopOAuth();
    const state = randomBytes(32).toString("hex");
    const config = structuredClone(this.state.app);
    this.oauth = {
      state,
      expiresAt: this.now() + 10 * 60_000,
      claimed: false,
      config,
      secret: this.secret("appSecret"),
    };
    const callback = new URL(config.redirectUri);
    if (
      ["localhost", "127.0.0.1"].includes(callback.hostname) &&
      callback.protocol === "http:"
    ) {
      if (!callback.port) {
        this.stopOAuth();
        throw new Error("本机回调必须指定端口，例如 47135。");
      }
      this.server = createServer((req, res) => {
        const url = new URL(req.url || "/", config.redirectUri);
        if (req.method !== "GET" || url.pathname !== callback.pathname) {
          res.writeHead(404).end();
          return;
        }
        if (!this.validState(url.searchParams.get("state"))) {
          res.writeHead(400).end("Invalid or expired authorization state.");
          return;
        }
        void this.completeAuthorization(url.toString())
          .then(() => {
            res
              .writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              })
              .end("授权完成，请返回桌面应用。");
          })
          .catch(() => {
            res
              .writeHead(400, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              })
              .end("授权未完成，请返回桌面应用查看原因。");
          });
      });
      try {
        await new Promise<void>((resolve, reject) => {
          this.server!.once("error", reject);
          this.server!.listen(Number(callback.port), "127.0.0.1", resolve);
        });
      } catch {
        this.stopOAuth();
        throw new Error(
          "授权回调端口被占用，请修改端口并同步更新 Meta 应用回调地址。",
        );
      }
    }
    const url = this.graph(config, this.oauth.secret).authorizationUrl(state);
    this.authorization = {
      status: "pending",
      message: "请在系统浏览器中完成授权并选择主页。",
      expiresAt: this.oauth.expiresAt,
      url,
    };
    this.authTimer = setTimeout(() => {
      this.authorization = {
        status: "expired",
        message: "授权已超时，请重新发起。",
      };
      this.stopOAuth();
    }, 10 * 60_000);
    try {
      await this.options.open(url);
    } catch {
      this.authorization.message = "无法自动打开浏览器，可复制授权链接打开。";
    }
    return this.authorization;
  }
  private validState(value: string | null) {
    return Boolean(
      this.oauth &&
      !this.oauth.claimed &&
      this.now() < this.oauth.expiresAt &&
      value &&
      /^[a-f0-9]{64}$/.test(value) &&
      value.length === this.oauth.state.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(this.oauth.state)),
    );
  }
  async completeAuthorization(callbackUrl: string) {
    const url = new URL(text(callbackUrl, 8192));
    const expected = new URL(
      this.oauth?.config.redirectUri || this.state.app.redirectUri,
    );
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      !this.validState(url.searchParams.get("state"))
    )
      throw new Error("授权回调地址、state 无效或已经处理，请重新发起授权。");
    const pending = this.oauth!;
    pending.claimed = true;
    this.authorization = {
      status: "processing",
      message: "正在交换授权并同步主页…",
    };
    try {
      if (url.searchParams.has("error"))
        throw new Error("Facebook 授权被取消或拒绝。");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("授权回调缺少 code。");
      const graph = this.graph(pending.config, pending.secret);
      const token = await graph.exchange(code);
      await this.connectPages(token, graph);
      this.authorization = {
        status: "completed",
        message: "授权成功，主页已连接。",
      };
    } catch (error) {
      this.authorization = {
        status: "failed",
        message:
          error instanceof GraphError
            ? error.message
            : "授权未完成，请检查应用配置、权限及回调地址。",
      };
      throw new Error(this.authorization.message);
    } finally {
      this.stopOAuth();
    }
  }
  async connectPages(token: string, graph = this.graph()) {
    if (this.busy || this.connecting)
      throw new Error("请等待当前发布或主页同步完成后再重新连接。");
    if (!this.state.app.appId || !this.state.app.hasSecret)
      throw new Error("请先配置你自己的 Meta 应用，再连接主页。");
    this.connecting = true;
    try {
      const pages = await graph.discover(text(token, 8192));
      for (const page of pages) {
        this.setSecret(`page:${page.id}`, String(page.access_token));
        const previous = this.state.pages.find((p) => p.id === String(page.id));
        const record: FacebookPage = {
          id: String(page.id),
          name: String(page.name),
          category: page.category,
          tasks: Array.isArray(page.tasks) ? page.tasks : [],
          connectedAt: this.now(),
          connected: true,
          rule: previous?.rule || defaultRule(),
        };
        if (previous) Object.assign(previous, record);
        else this.state.pages.push(record);
      }
      this.setSecret("userToken", token);
      const ids = new Set(pages.map((page) => String(page.id)));
      this.state.pages.forEach((page) => {
        if (!ids.has(page.id)) {
          page.connected = false;
          page.rule.enabled = false;
        }
      });
      this.save();
    } finally {
      this.connecting = false;
    }
  }
  disconnect(id: string) {
    if (this.busy || this.connecting)
      throw new Error("请等待当前发布或主页同步完成。");
    const page = this.page(id);
    page.connected = false;
    page.rule.enabled = false;
    delete this.encrypted[`page:${id}`];
    this.atomic("credentials.enc.json", this.encrypted);
    for (const task of this.state.tasks)
      if (task.pageId === id && task.status === "queued")
        task.status = "cancelled";
    this.save();
  }
  private page(id: string) {
    const page = this.state.pages.find((value) => value.id === id);
    if (!page) throw new Error("主页不存在。");
    return page;
  }

  importMedia(paths: unknown) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100)
      throw new Error("每次请选择 1–100 个本地素材。");
    return paths.map((input) => {
      const source = this.options.allowed(text(input, 4096));
      const extension = extname(source).toLowerCase();
      const kind = [".jpg", ".jpeg", ".png"].includes(extension)
        ? "image"
        : [".mp4", ".mov"].includes(extension)
          ? "video"
          : undefined;
      if (!kind) throw new Error("发帖素材支持 JPG、PNG、MP4、MOV。");
      const info = statSync(source);
      if (
        !info.isFile() ||
        info.size === 0 ||
        info.size > (kind === "image" ? 20 * 1024 ** 2 : 4 * 1024 ** 3)
      )
        throw new Error("素材为空或超过大小限制（图片 20 MB、视频 4 GB）。");
      const id = randomUUID();
      const path = join(this.options.root, "media", `${id}${extension}`);
      copyFileSync(source, path);
      return {
        id,
        path,
        source,
        name: basename(source),
        kind,
        size: info.size,
      } as Media;
    });
  }
  private validateMedia(value: unknown): Media[] {
    if (!Array.isArray(value) || value.length > 100)
      throw new Error("素材列表无效。");
    return value.map((media: Media) => {
      const extension = extname(text(media.path, 4096)).toLowerCase();
      const expected = join(
        this.options.root,
        "media",
        `${text(media.id, 100)}${extension}`,
      );
      if (
        !/^[a-f0-9-]{36}$/.test(media.id) ||
        expected !== media.path ||
        !existsSync(expected)
      )
        throw new Error("素材不存在，请重新导入。");
      const kind = [".jpg", ".jpeg", ".png"].includes(extension)
        ? "image"
        : [".mp4", ".mov"].includes(extension)
          ? "video"
          : undefined;
      if (!kind || kind !== media.kind) throw new Error("素材类型无效。");
      return {
        id: media.id,
        path: expected,
        source: text(media.source, 4096),
        kind,
        name: text(media.name, 255),
        size: statSync(expected).size,
      };
    });
  }
  savePost(input: Record<string, any>) {
    const previous = input.id
      ? this.state.posts.find((post) => post.id === input.id)
      : undefined;
    if (input.id && !previous) throw new Error("帖子不存在。");
    if (
      previous &&
      this.state.tasks.some(
        (task) => task.postId === previous.id && task.status !== "cancelled",
      )
    )
      throw new Error("帖子已分配发布任务，不能修改；可复制为新草稿。");
    const media = this.validateMedia(input.media || []);
    const videos = media.filter((m) => m.kind === "video");
    if ((videos.length && media.length !== 1) || media.length > 10)
      throw new Error("每条帖子最多 10 张图片或 1 个视频，不能混合。");
    for (const video of videos) {
      if (
        this.state.posts.some(
          (post) =>
            post.id !== previous?.id &&
            post.media.some(
              (m) => m.kind === "video" && m.source === video.source,
            ),
        )
      )
        throw new Error("该视频已关联其他帖子，请使用新的素材版本。");
    }
    const copy = text(input.copy, 60_000);
    if (!copy && !media.length) throw new Error("帖子文案和素材不能同时为空。");
    const review = input.review === "approved" ? "approved" : "pending";
    const post: Post = {
      id: previous?.id || randomUUID(),
      title: text(input.title || "未命名帖子", 200),
      copy,
      media,
      language: text(input.language || "简体中文", 50),
      tags: tags(input.tags || []),
      review,
      createdAt: previous?.createdAt || this.now(),
      updatedAt: this.now(),
    };
    if (previous) Object.assign(previous, post);
    else this.state.posts.unshift(post);
    this.save();
    return structuredClone(post);
  }
  reviewPost(id: string, approved: boolean) {
    const post = this.state.posts.find((p) => p.id === id);
    if (
      !post ||
      this.state.tasks.some((t) => t.postId === id && t.status !== "cancelled")
    )
      throw new Error("帖子不存在或已分配发布任务。");
    post.review = approved ? "approved" : "pending";
    post.updatedAt = this.now();
    this.save();
  }
  deletePost(id: string) {
    if (this.state.tasks.some((task) => task.postId === id))
      throw new Error("已分配过发布任务的帖子需要保留。");
    this.state.posts = this.state.posts.filter((post) => post.id !== id);
    this.save();
  }
  saveTemplate(input: Record<string, any>) {
    const template: CopyTemplate = {
      id: input.id || randomUUID(),
      name: text(input.name, 100),
      body: text(input.body, 20_000),
    };
    if (!template.name || !template.body)
      throw new Error("模板名称和正文不能为空。");
    const existing = this.state.templates.find((t) => t.id === template.id);
    if (existing) Object.assign(existing, template);
    else this.state.templates.push(template);
    this.save();
  }
  async generate(input: GenerationInput) {
    if (this.generating) throw new Error("正在生成帖子，请等待完成。");
    const quantity = integer(input.quantity, 1, 50);
    const template = this.state.templates.find(
      (t) => t.id === input.templateId,
    );
    if (!template) throw new Error("请选择有效文案模板。");
    const context = {
      title: text(input.title, 200),
      description: text(input.description, 20_000),
      language: text(input.language, 50),
      tags: tags(input.tags),
    };
    const media = this.validateMedia(input.media);
    const videos = media.filter((m) => m.kind === "video");
    if (videos.length && videos.length !== media.length)
      throw new Error("批量生成不能混用图片和视频。");
    if (videos.length && quantity !== videos.length)
      throw new Error("视频模式每个视频生成一条帖子，数量必须与视频数一致。");
    const imagesPerPost = integer(input.imagesPerPost, 0, 10);
    if (imagesPerPost > media.length && !videos.length)
      throw new Error("引用图片数量超过已选素材。");
    const results: { id?: string; error?: string }[] = [];
    this.generating = true;
    try {
      for (let index = 0; index < quantity; index++) {
        if (this.closed) break;
        try {
          const draft = renderTemplate(template.body, context, index + 1);
          const copy =
            input.mode === "ai"
              ? await this.generateAi(template.body, context, index + 1)
              : draft;
          const selected = videos.length
            ? [videos[index]]
            : Array.from(
                { length: imagesPerPost },
                (_, n) =>
                  media[
                    (index * Math.max(imagesPerPost, 1) + n) % media.length
                  ],
              );
          const post = this.savePost({
            ...context,
            title: `${context.title || "帖子"} ${index + 1}`,
            copy,
            media: selected,
            review: "pending",
          });
          results.push({ id: post.id });
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : "生成失败",
          });
        }
      }
    } finally {
      this.generating = false;
    }
    return results;
  }
  private async generateAi(
    template: string,
    context: Pick<
      GenerationInput,
      "title" | "description" | "language" | "tags"
    >,
    index: number,
  ) {
    const config = this.state.ai;
    if (!config.model) throw new Error("请先配置 AI 接口和模型。");
    const key = this.secret("aiKey");
    try {
      const response = await this.request(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(90_000),
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: "system",
                content: `按模板和资料生成 ${context.language} 社交媒体帖子。只返回最终文案正文，不要 JSON 或分析过程。\n模板：\n${template}`,
              },
              {
                role: "user",
                content: renderTemplate(
                  "标题：{title}\n资料：{description}\n标签：{tags}\n语种：{language}\n本批次第 {index} 条，请避免重复。",
                  context,
                  index,
                ),
              },
            ],
          }),
        },
      );
      if (!response.ok)
        throw new Error(`AI 接口返回 HTTP ${response.status}。`);
      const data = await response.json();
      const value = data.choices?.[0]?.message?.content;
      const copy =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value.map((p: { text?: string }) => p.text || "").join("")
            : "";
      if (!copy.trim()) throw new Error("AI 未返回有效文案。");
      return text(copy, 60_000);
    } catch (error) {
      throw new Error(
        error instanceof Error &&
          /^(AI 接口返回 HTTP|AI 未返回|文本字段)/.test(error.message)
          ? error.message
          : "AI 请求失败，请检查接口配置和网络。",
      );
    }
  }

  saveRule(pageId: string, input: PageRule) {
    const page = this.page(pageId);
    const dailyLimit = integer(input.dailyLimit, 0, 100);
    if (
      !Number.isFinite(input.intervalHours) ||
      input.intervalHours < 0.05 ||
      input.intervalHours > 720
    )
      throw new Error("发布间隔必须在 0.05–720 小时之间。");
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!clock.test(input.start) || !clock.test(input.end))
      throw new Error("时间窗口应使用 HH:mm 格式。");
    if (!["feed", "reel"].includes(input.format))
      throw new Error("发布类型无效。");
    const rule = {
      enabled: Boolean(input.enabled),
      tags: tags(input.tags),
      dailyLimit,
      intervalHours: input.intervalHours,
      start: input.start,
      end: input.end,
      format: input.format,
    } as PageRule;
    if (rule.enabled && (!page.connected || !rule.tags.length))
      throw new Error("请先连接主页并设置至少一个内容标签。");
    page.rule = rule;
    this.save();
  }
  enqueue(
    postId: string,
    pageId: string,
    format: "feed" | "reel",
    scheduledAt: number,
  ) {
    const post = this.state.posts.find((p) => p.id === postId);
    const page = this.page(pageId);
    if (!page.connected || !this.encrypted[`page:${pageId}`])
      throw new Error("主页授权未连接，请重新授权。");
    if (!post || post.review !== "approved")
      throw new Error("只有已审核帖子可以加入发布任务。");
    if (
      this.state.tasks.some(
        (task) => task.postId === postId && task.status !== "cancelled",
      )
    )
      throw new Error("该帖子已分配发布任务，不会重复发布。");
    if (!["feed", "reel"].includes(format)) throw new Error("发布类型无效。");
    if (!Number.isFinite(scheduledAt) || scheduledAt < 0)
      throw new Error("发布时间无效。");
    if (
      format === "reel" &&
      (post.media.length !== 1 || post.media[0].kind !== "video")
    )
      throw new Error("Reels 必须包含一个视频。");
    const task: PublishTask = {
      id: randomUUID(),
      postId,
      pageId,
      snapshot: structuredClone(post),
      format,
      status: "queued",
      scheduledAt,
      createdAt: this.now(),
      attempts: 0,
      photoIds: [],
    };
    this.state.tasks.unshift(task);
    this.save();
    return structuredClone(task);
  }
  private scan() {
    const now = this.now();
    for (const page of this.state.pages) {
      const rule = page.rule;
      if (!page.connected || !rule.enabled || !withinWindow(rule, now))
        continue;
      const reserved = this.state.tasks.filter(
        (task) =>
          task.pageId === page.id &&
          task.status !== "cancelled" &&
          task.status !== "failed",
      );
      const recent = reserved.filter(
        (task) =>
          (task.publishedAt || task.scheduledAt) >= now - 24 * 3600_000 &&
          (task.publishedAt || task.scheduledAt) <= now,
      );
      if (rule.dailyLimit && recent.length >= rule.dailyLimit) continue;
      if (
        reserved.some((task) =>
          ["queued", "publishing", "processing", "uncertain"].includes(
            task.status,
          ),
        )
      )
        continue;
      const last = Math.max(
        0,
        ...reserved.map((task) => task.publishedAt || task.scheduledAt),
      );
      if (last && now < last + rule.intervalHours * 3600_000) continue;
      const post = [...this.state.posts]
        .reverse()
        .find(
          (post) =>
            post.review === "approved" &&
            post.tags.some((tag) => rule.tags.includes(tag)) &&
            !this.state.tasks.some(
              (task) => task.postId === post.id && task.status !== "cancelled",
            ) &&
            (rule.format !== "reel" ||
              (post.media.length === 1 && post.media[0].kind === "video")),
        );
      if (post) this.enqueue(post.id, page.id, rule.format, now);
    }
  }
  async tick() {
    if (
      this.busy ||
      this.closed ||
      this.state.paused ||
      this.connecting ||
      this.oauth
    )
      return;
    this.busy = true;
    try {
      this.scan();
      const now = this.now();
      const processing = this.state.tasks.find(
        (task) => task.status === "processing" && (task.retryAt || 0) <= now,
      );
      if (processing) {
        await this.reconcile(processing);
        return;
      }
      const task = [...this.state.tasks]
        .reverse()
        .find(
          (t) =>
            t.status === "queued" &&
            t.scheduledAt <= now &&
            (t.retryAt || 0) <= now,
        );
      if (task) await this.publish(task);
    } catch {
      /* Configuration/network failures are exposed on individual tasks. */
    } finally {
      this.busy = false;
    }
  }
  private async publish(task: PublishTask) {
    task.status = "publishing";
    task.startedAt = this.now();
    task.attempts++;
    task.error = undefined;
    this.save();
    try {
      const page = this.page(task.pageId);
      if (!page.connected) throw new Error("主页已断开，请重新授权。");
      const token = this.secret(`page:${page.id}`);
      if (!token) throw new Error("主页授权缺失，请重新授权。");
      for (const media of task.snapshot.media)
        if (!existsSync(media.path)) throw new Error("本地发布素材已丢失。");
      const graph = this.graph();
      if (task.format === "reel") {
        const start = await graph.startReel(page.id, token);
        task.remoteId = start.id;
        this.save();
        await graph.uploadReel(start.url, token, task.snapshot.media[0]);
        task.finalSubmitted = true;
        this.save();
        const finish = await graph.finishReel(
          page.id,
          token,
          start.id,
          task.snapshot,
        );
        if (finish.success !== true)
          throw new GraphError("Meta 未确认发布提交。", undefined, true);
        task.status = "processing";
        task.retryAt = this.now() + 15_000;
      } else if (task.snapshot.media[0]?.kind === "video") {
        task.finalSubmitted = true;
        this.save();
        const result = await graph.video(page.id, token, task.snapshot);
        if (!result.id)
          throw new GraphError("Meta 未返回视频编号。", undefined, true);
        task.remoteId = String(result.id);
        task.url = `https://www.facebook.com/${page.id}/videos/${encodeURIComponent(task.remoteId)}`;
        task.status = "processing";
        task.retryAt = this.now() + 15_000;
      } else {
        for (
          let i = task.photoIds.length;
          i < task.snapshot.media.length;
          i++
        ) {
          const photo = await graph.photo(
            page.id,
            token,
            task.snapshot.media[i],
          );
          if (!photo.id) throw new GraphError("Meta 未返回图片编号。");
          task.photoIds.push(String(photo.id));
          this.save();
        }
        task.finalSubmitted = true;
        this.save();
        const result = await graph.feed(
          page.id,
          token,
          task.snapshot.copy,
          task.photoIds,
        );
        if (!result.id)
          throw new GraphError("Meta 未返回帖子编号。", undefined, true);
        task.remoteId = String(result.id);
        task.url = `https://www.facebook.com/${encodeURIComponent(task.remoteId)}`;
        task.status = "published";
        task.publishedAt = this.now();
      }
    } catch (error) {
      const uncertain =
        task.finalSubmitted &&
        (!(error instanceof GraphError) || error.ambiguous);
      task.status = uncertain ? "uncertain" : "failed";
      task.error =
        error instanceof GraphError
          ? error.message
          : "发布未完成，请检查本地素材、授权配置和网络。";
      if (error instanceof GraphError && error.code === 190) {
        const page = this.page(task.pageId);
        page.connected = false;
        page.rule.enabled = false;
      }
    }
    this.save();
  }
  private async reconcile(task: PublishTask) {
    if (!task.remoteId)
      throw new Error("该任务没有远端编号，需在 Facebook 主页人工核实。");
    try {
      const page = this.page(task.pageId);
      if (!page.connected) throw new Error("请先重新授权该主页。");
      const data = await this.graph().status(
        task.remoteId,
        this.secret(`page:${page.id}`),
      );
      const status = data.status || {};
      if (
        status.video_status === "error" ||
        status.publishing_phase?.status === "error" ||
        status.processing_phase?.status === "error"
      ) {
        task.status = "failed";
        task.error = "Meta 视频处理失败，请检查媒体要求后重试。";
      } else if (
        task.format === "reel"
          ? status.publishing_phase?.status === "complete"
          : status.video_status === "ready"
      ) {
        task.status = "published";
        task.publishedAt = this.now();
        task.error = undefined;
        task.url ||= `https://www.facebook.com/reel/${encodeURIComponent(task.remoteId)}`;
      } else {
        task.status =
          this.now() - (task.startedAt || task.createdAt) > 24 * 3600_000
            ? "uncertain"
            : "processing";
        task.retryAt = this.now() + 30_000;
      }
    } catch (error) {
      task.error =
        error instanceof GraphError
          ? error.message
          : "无法查询远端状态，请检查授权与网络。";
      task.retryAt = this.now() + 60_000;
      if (error instanceof GraphError && error.code === 190) {
        const page = this.page(task.pageId);
        page.connected = false;
        page.rule.enabled = false;
        task.status = "uncertain";
      }
      if (this.now() - (task.startedAt || task.createdAt) > 24 * 3600_000)
        task.status = "uncertain";
    }
    this.save();
  }
  async taskAction(id: string, action: string) {
    const task = this.state.tasks.find((task) => task.id === id);
    if (!task) throw new Error("发布任务不存在。");
    if (action === "cancel" && task.status === "queued")
      task.status = "cancelled";
    else if (action === "retry" && task.status === "failed") {
      if (task.attempts >= 3)
        throw new Error("已达到 3 次尝试上限，请检查失败原因。");
      task.status = "queued";
      task.finalSubmitted = false;
      task.remoteId = undefined;
      task.retryAt = undefined;
    } else if (
      action === "check" &&
      ["uncertain", "processing"].includes(task.status) &&
      task.remoteId
    ) {
      if (this.busy) throw new Error("正在处理发布任务，请稍候。");
      this.busy = true;
      try {
        await this.reconcile(task);
      } finally {
        this.busy = false;
      }
    } else throw new Error("当前状态不支持此操作；结果不确定时不能直接重试。");
    this.save();
  }
  async dispatch(
    method: string,
    params: Record<string, any> = {},
  ): Promise<unknown> {
    switch (method) {
      case "snapshot":
        return this.snapshot();
      case "app.save":
        this.configureApp(params);
        break;
      case "ai.save":
        this.configureAi(params);
        break;
      case "auth.start":
        return this.authorize();
      case "auth.complete":
        await this.completeAuthorization(params.url);
        break;
      case "auth.import":
        await this.connectPages(text(params.token, 8192));
        break;
      case "auth.refresh":
        await this.connectPages(this.secret("userToken"));
        break;
      case "page.disconnect":
        this.disconnect(text(params.id));
        break;
      case "page.rule":
        this.saveRule(text(params.id), params.rule);
        break;
      case "media.import":
        return this.importMedia(params.paths);
      case "post.save":
        return this.savePost(params);
      case "post.review":
        this.reviewPost(text(params.id), Boolean(params.approved));
        break;
      case "post.delete":
        this.deletePost(text(params.id));
        break;
      case "template.save":
        this.saveTemplate(params);
        break;
      case "posts.generate":
        return this.generate(params as GenerationInput);
      case "task.create":
        return this.enqueue(
          text(params.postId),
          text(params.pageId),
          params.format,
          params.scheduledAt,
        );
      case "task.action":
        await this.taskAction(text(params.id), text(params.action));
        break;
      case "scheduler.pause":
        this.state.paused = Boolean(params.paused);
        this.save();
        break;
      default:
        throw new Error("不支持的发布调用。");
    }
    return this.snapshot();
  }
}
