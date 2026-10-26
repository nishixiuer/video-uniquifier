import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, Server } from "node:http";
import { PublishingService, renderTemplate, withinWindow } from "./service";
import { SCOPES } from "./graph";
import { defaultRule, type GenerationInput } from "../shared/publishing";
import {
  CALLBACK_MAPPING,
  type CallbackMappingAdapter,
} from "../shared/callback-mapping";

let root: string;
let service: PublishingService;
let now: number;
let reply: (
  url: URL,
  init?: RequestInit,
) => object | Response | Promise<object | Response>;
let request: ReturnType<typeof vi.fn>;
let opened: string;
const app = {
  appId: "123",
  secret: "APP_SECRET_PRIVATE",
  version: "v26.0",
  redirectUri: "https://example.com/facebook/callback",
};
const originalReply = (url: URL) => {
  if (url.pathname.endsWith("/me/permissions"))
    return {
      data: SCOPES.map((permission) => ({ permission, status: "granted" })),
    };
  if (url.pathname.endsWith("/me/accounts"))
    return {
      data: [
        {
          id: "42",
          name: "测试主页",
          access_token: "PAGE_TOKEN_PRIVATE",
          tasks: ["CREATE_CONTENT"],
        },
      ],
    };
  if (url.pathname.endsWith("/oauth/access_token"))
    return { access_token: "USER_TOKEN_PRIVATE" };
  if (url.pathname.endsWith("/feed")) return { id: "42_99" };
  if (url.pathname.endsWith("/photos")) return { id: "77" };
  if (url.pathname.endsWith("/videos")) return { id: "88" };
  if (url.pathname.endsWith("/88"))
    return {
      status: {
        video_status: "ready",
        publishing_phase: { status: "complete" },
      },
    };
  throw new Error(`Unexpected test request: ${url.pathname}`);
};
function create(secure = true, callbackMapping?: CallbackMappingAdapter) {
  return new PublishingService({
    root,
    secure: () => secure,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString(),
    allowed: (path) => path,
    open: async (url) => {
      opened = url;
    },
    fetch: request as typeof fetch,
    now: () => now,
    callbackMapping,
  });
}
async function connect() {
  service.configureApp(app);
  await service.connectPages("USER_TOKEN_PRIVATE");
}
function post(extra: Record<string, unknown> = {}) {
  return service.savePost({
    title: "测试帖子",
    copy: "测试正文",
    tags: ["短剧"],
    review: "approved",
    ...extra,
  });
}
function media(name = "input.jpg") {
  const path = join(root, name);
  writeFileSync(path, "local-test-media");
  return service.importMedia([path])[0];
}
function task(extra: Record<string, unknown> = {}) {
  const draft = post(extra);
  return service.enqueue(draft.id, "42", "feed", now);
}
const current = (id: string) =>
  service.snapshot().tasks.find((t) => t.id === id)!;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "publishing-unit-"));
  now = new Date(2026, 9, 26, 12, 0).getTime();
  opened = "";
  reply = originalReply;
  request = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const result = await reply(new URL(String(input)), init);
    return result instanceof Response ? result : Response.json(result);
  });
  service = create();
});
afterEach(() => {
  service.close();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("local posts, templates and AI", () => {
  it("renders template variables and preserves unknown placeholders", () => {
    expect(
      renderTemplate(
        "{title}\n{description}\n{tags} #{index} {unknown}",
        {
          title: "标题",
          description: "资料",
          tags: ["好 剧"],
          language: "中文",
        },
        2,
      ),
    ).toBe("标题\n资料\n#好_剧 #2 {unknown}");
  });
  it("saves, reviews and restores posts without external calls", async () => {
    const draft = post({ review: "pending" });
    service.reviewPost(draft.id, true);
    expect(service.snapshot().posts[0].review).toBe("approved");
    service.savePost({ ...draft, copy: "编辑后" });
    service.close();
    service = create();
    expect(service.snapshot().posts[0].copy).toBe("编辑后");
    expect(request).not.toHaveBeenCalled();
    service.deletePost(draft.id);
    expect(service.snapshot().posts).toEqual([]);
    await expect(service.dispatch("invalid")).rejects.toThrow("不支持");
  });
  it("imports local media and rejects mixed images/video, oversize and path injection", () => {
    const image = media();
    const video = media("input.mp4");
    expect(readFileSync(image.path, "utf8")).toBe("local-test-media");
    expect(() => post({ media: [image, video] })).toThrow("不能混合");
    expect(() => post({ media: [{ ...image, path: "/etc/passwd" }] })).toThrow(
      "素材不存在",
    );
    expect(() => service.importMedia([join(root, "test.txt")])).toThrow("支持");
    post({ media: [video] });
    expect(() => post({ media: [video] })).toThrow("已关联");
    expect(() => post({ copy: "", media: [] })).toThrow("不能同时为空");
  });
  it("generates pending drafts with rotating image batches", async () => {
    const a = media("a.jpg"),
      b = media("b.png");
    service.saveTemplate({
      name: "测试模板",
      body: "{title} - {index} {tags}",
    });
    const result = await service.generate({
      title: "剧情",
      description: "简介",
      language: "简体中文",
      tags: ["短剧"],
      quantity: 2,
      templateId: service.snapshot().templates[1].id,
      mode: "template",
      media: [a, b],
      imagesPerPost: 1,
    });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.id)).toBe(true);
    const rows = service.snapshot().posts;
    expect(rows.map((p) => p.review)).toEqual(["pending", "pending"]);
    expect(rows[0].media[0].id).not.toBe(rows[1].media[0].id);
    expect(request).not.toHaveBeenCalled();
  });
  it("uses configured AI and sanitizes failures without uploading local files", async () => {
    service.configureAi({
      baseUrl: "https://ai.example.test/v1",
      model: "custom-model",
      key: "AI_SECRET_PRIVATE",
    });
    const bodies: string[] = [];
    reply = (url, init) => {
      expect(url.toString()).toBe(
        "https://ai.example.test/v1/chat/completions",
      );
      bodies.push(String(init?.body));
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer AI_SECRET_PRIVATE",
      );
      return bodies.length === 1
        ? { choices: [{ message: { content: "生成的正文" } }] }
        : new Response("AI_SECRET_PRIVATE", { status: 401 });
    };
    const result = await service.generate({
      title: "剧情",
      description: "简介",
      language: "英语",
      tags: [],
      quantity: 2,
      templateId: "default",
      mode: "ai",
      media: [media()],
      imagesPerPost: 1,
    });
    expect(result[0].id).toBeTruthy();
    expect(result[1].error).toBe("AI 接口返回 HTTP 401。");
    expect(bodies.join()).not.toContain(root);
    expect(JSON.stringify(service.snapshot())).not.toContain(
      "AI_SECRET_PRIVATE",
    );
    expect(readFileSync(join(root, "publishing.json"), "utf8")).not.toContain(
      "AI_SECRET_PRIVATE",
    );
    expect(
      readFileSync(join(root, "credentials.enc.json"), "utf8"),
    ).not.toContain("AI_SECRET_PRIVATE");
  });
  it("validates generation sizes and reports per-video reservation conflicts", async () => {
    const input: GenerationInput = {
      title: "a",
      description: "b",
      language: "中文",
      tags: [],
      quantity: 1,
      templateId: "default",
      mode: "template",
      media: [media("one.mp4")],
      imagesPerPost: 0,
    };
    await expect(service.generate({ ...input, quantity: 0 })).rejects.toThrow(
      "数量",
    );
    await expect(service.generate({ ...input, quantity: 2 })).rejects.toThrow(
      "数量必须",
    );
    expect((await service.generate(input))[0].id).toBeTruthy();
    expect((await service.generate(input))[0].error).toContain("已关联");
  });
  it("refuses plaintext credential fallback and unsafe AI endpoints", () => {
    service.close();
    service = create(false);
    expect(() => service.configureApp(app)).toThrow("安全存储");
    expect(() =>
      service.configureAi({ baseUrl: "http://public.example/v1", model: "x" }),
    ).toThrow("HTTPS");
    service.configureAi({
      baseUrl: "http://localhost:11434/v1",
      model: "local",
    });
    expect(service.snapshot().ai.hasKey).toBe(false);
  });
});

describe("official OAuth", () => {
  it("switches mapping on/off, cancels pending auth and restores the saved callback across restart", async () => {
    const mapping = { set: vi.fn(async () => {}) };
    service.close();
    service = create(true, mapping);
    service.configureApp(app);
    await service.authorize();
    const previous = new URL(opened).searchParams.get("state");
    await service.setCallbackMapping(true);
    expect(service.snapshot().app).toMatchObject({
      redirectUri: CALLBACK_MAPPING.redirectUri,
      localCallback: { previousRedirectUri: app.redirectUri },
    });
    expect(service.snapshot().authorization.status).toBe("idle");
    await expect(
      service.completeAuthorization(
        `${app.redirectUri}?state=${previous}&code=old`,
      ),
    ).rejects.toThrow("state");
    expect(() => service.configureApp(app)).toThrow("先关闭");
    service.configureApp({ ...app, redirectUri: CALLBACK_MAPPING.redirectUri });
    expect(service.snapshot().app.localCallback).toBeDefined();
    service.close();
    service = create(true, mapping);
    await service.setCallbackMapping(true);
    await service.setCallbackMapping(false);
    expect(service.snapshot().app.redirectUri).toBe(app.redirectUri);
    expect(service.snapshot().app.localCallback).toBeUndefined();
    expect(mapping.set).toHaveBeenLastCalledWith(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps saved configuration when Yerd fails and rejects unsupported platforms/invalid switches", async () => {
    service.configureApp(app);
    await expect(service.setCallbackMapping(true)).rejects.toThrow("Yerd");
    service.close();
    service = create(true, {
      set: async () => {
        throw new Error("代理冲突");
      },
    });
    await expect(service.setCallbackMapping(true)).rejects.toThrow("代理冲突");
    expect(service.snapshot().app.redirectUri).toBe(app.redirectUri);
    expect(service.snapshot().app.localCallback).toBeUndefined();
    await expect(
      service.dispatch("app.mapping", { enabled: "yes" }),
    ).rejects.toThrow("开关无效");
    service.configureApp(app);
  });
  it("uses the HTTPS domain in OAuth/token exchange while receiving callbacks only on loopback", async () => {
    const mapping = { set: vi.fn(async () => {}) };
    service.close();
    service = create(true, mapping);
    service.configureApp(app);
    await service.setCallbackMapping(true);
    // Redirect the production listener to an ephemeral port so this test cannot collide with the real desktop.
    const listen = Server.prototype.listen;
    let listener!: Server;
    const spy = vi
      .spyOn(Server.prototype, "listen")
      .mockImplementation(function (this: Server, ...args: any[]) {
        listener = this;
        expect(args[0]).toBe(47135);
        expect(args[1]).toBe("127.0.0.1");
        return Reflect.apply(listen, this, [0, "127.0.0.1", args[2]]);
      } as typeof Server.prototype.listen);
    await service.authorize();
    spy.mockRestore();
    const url = new URL(opened);
    expect(url.searchParams.get("redirect_uri")).toBe(
      CALLBACK_MAPPING.redirectUri,
    );
    const port = (listener.address() as { port: number }).port;
    const response = await fetch(
      `http://127.0.0.1:${port}/facebook/callback?state=${url.searchParams.get("state")}&code=mapped`,
    );
    expect(response.status).toBe(200);
    expect(service.snapshot().authorization.status).toBe("completed");
    const exchange = request.mock.calls.find(([target]) =>
      new URL(String(target)).searchParams.has("code"),
    )!;
    expect(new URL(String(exchange[0])).searchParams.get("redirect_uri")).toBe(
      CALLBACK_MAPPING.redirectUri,
    );
  });
  it("cancels and invalidates an OAuth attempt so configuration can be edited immediately", async () => {
    service.configureApp(app);
    await service.authorize();
    const old = new URL(opened).searchParams.get("state");
    await service.dispatch("auth.cancel");
    expect(service.snapshot().authorization.url).toBeUndefined();
    service.configureApp(app);
    await expect(
      service.completeAuthorization(`${app.redirectUri}?state=${old}&code=old`),
    ).rejects.toThrow("state");
    expect(request).not.toHaveBeenCalled();
  });
  it("handles an actual loopback callback, ignores invalid state and closes the listener", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const redirectUri = `http://127.0.0.1:${port}/facebook/callback`;
    service.configureApp({ ...app, redirectUri });
    await service.authorize();
    expect((await fetch(`${redirectUri}?state=invalid&code=bad`)).status).toBe(
      400,
    );
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
    expect(request).not.toHaveBeenCalled();
    const state = new URL(opened).searchParams.get("state");
    const response = await fetch(`${redirectUri}?state=${state}&code=good`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("授权完成");
    expect(service.snapshot().pages[0].connected).toBe(true);
    expect(service.snapshot().authorization.status).toBe("completed");
    await expect(
      fetch(`${redirectUri}?state=${state}&code=replay`),
    ).rejects.toThrow();
  });
  it("exchanges one state-bound code, syncs pages and never exposes tokens", async () => {
    service.configureApp(app);
    await service.authorize();
    const login = new URL(opened);
    expect(login.hostname).toBe("www.facebook.com");
    expect(login.searchParams.get("scope")).toContain("pages_manage_posts");
    const callback = `${app.redirectUri}?state=${login.searchParams.get("state")}&code=one-code`;
    await expect(
      service.completeAuthorization(
        `${app.redirectUri}?state=${"中".repeat(64)}&code=bad`,
      ),
    ).rejects.toThrow("state");
    await expect(
      service.completeAuthorization(
        callback.replace("example.com", "evil.example"),
      ),
    ).rejects.toThrow("state");
    await service.completeAuthorization(callback);
    expect(service.snapshot().pages[0].connected).toBe(true);
    expect(service.snapshot().authorization.status).toBe("completed");
    expect(JSON.stringify(service.snapshot())).not.toMatch(
      /PAGE_TOKEN_PRIVATE|USER_TOKEN_PRIVATE|APP_SECRET_PRIVATE/,
    );
    await expect(service.completeAuthorization(callback)).rejects.toThrow(
      "state",
    );
    service.disconnect("42");
    expect(service.snapshot().pages[0].connected).toBe(false);
  });
  it("rejects expired states and denied authorization without Graph requests", async () => {
    service.configureApp(app);
    await service.authorize();
    const url = new URL(opened);
    await expect(
      service.completeAuthorization(
        `${app.redirectUri}?state=${url.searchParams.get("state")}&error=access_denied`,
      ),
    ).rejects.toThrow("未完成");
    expect(request).not.toHaveBeenCalled();
    await service.authorize();
    const second = new URL(opened);
    now += 11 * 60_000;
    await expect(
      service.completeAuthorization(
        `${app.redirectUri}?state=${second.searchParams.get("state")}&code=x`,
      ),
    ).rejects.toThrow("state");
  });
  it("validates app callback and blocks an application switch with pending OAuth", async () => {
    expect(() =>
      service.configureApp({
        ...app,
        redirectUri: "http://example.com/callback",
      }),
    ).toThrow("HTTPS");
    expect(() => service.configureApp({ ...app, version: "latest" })).toThrow(
      "版本",
    );
    service.configureApp(app);
    await service.authorize();
    expect(() => service.configureApp(app)).toThrow("当前授权");
  });
});

describe("durable publishing and scheduler", () => {
  it("excludes config switches, concurrent sync and publishing during page synchronization", async () => {
    await connect();
    const queued = task();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply = async (url) => {
      if (url.pathname.endsWith("permissions")) await pending;
      return originalReply(url);
    };
    const syncing = service.connectPages("USER_TOKEN_PRIVATE");
    await service.tick();
    expect(current(queued.id).attempts).toBe(0);
    expect(() => service.configureApp(app)).toThrow("等待");
    expect(() => service.disconnect("42")).toThrow("等待");
    await expect(service.authorize()).rejects.toThrow("等待");
    await expect(service.connectPages("OTHER")).rejects.toThrow("等待");
    release();
    await syncing;
    await service.tick();
    expect(current(queued.id).status).toBe("published");
  });
  it("requires approval, snapshots content and reserves a post exactly once", async () => {
    await connect();
    const draft = post({ review: "pending" });
    expect(() => service.enqueue(draft.id, "42", "feed", now)).toThrow(
      "已审核",
    );
    service.reviewPost(draft.id, true);
    const queued = service.enqueue(draft.id, "42", "feed", now);
    expect(() => service.enqueue(draft.id, "42", "feed", now)).toThrow("重复");
    expect(() => service.savePost({ ...draft, copy: "changed" })).toThrow(
      "不能修改",
    );
    await service.tick();
    expect(current(queued.id).status).toBe("published");
    expect(current(queued.id).snapshot.copy).toBe("测试正文");
    await service.tick();
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith("/42/feed")),
    ).toHaveLength(1);
  });
  it("uploads unpublished images before the final feed and retains photo IDs", async () => {
    await connect();
    const queued = task({ media: [media()] });
    await service.tick();
    expect(current(queued.id).photoIds).toEqual(["77"]);
    const upload = request.mock.calls.find(([url]) =>
      String(url).endsWith("/photos"),
    )!;
    expect((upload[1].body as FormData).get("published")).toBe("false");
    expect((upload[1].body as FormData).get("source")).toBeInstanceOf(Blob);
    const feed = request.mock.calls.find(([url]) =>
      String(url).endsWith("/feed"),
    )!;
    expect((feed[1].body as URLSearchParams).get("attached_media[0]")).toBe(
      '{"media_fbid":"77"}',
    );
  });
  it("treats an interrupted final POST as uncertain and never retries automatically", async () => {
    await connect();
    const queued = task();
    reply = (url) => {
      if (url.pathname.endsWith("/feed"))
        throw new TypeError("network includes PAGE_TOKEN_PRIVATE");
      return originalReply(url);
    };
    await service.tick();
    expect(current(queued.id).status).toBe("uncertain");
    expect(current(queued.id).error).not.toContain("PAGE_TOKEN_PRIVATE");
    await expect(service.taskAction(queued.id, "retry")).rejects.toThrow(
      "不确定",
    );
    const count = request.mock.calls.length;
    await service.tick();
    expect(request).toHaveBeenCalledTimes(count);
  });
  it("permits bounded explicit retry on confirmed rejection and cancels queued tasks", async () => {
    await connect();
    const queued = task();
    reply = (url) =>
      url.pathname.endsWith("/feed")
        ? Response.json(
            { error: { code: 100, message: "private URL and token" } },
            { status: 400 },
          )
        : originalReply(url);
    for (let i = 0; i < 3; i++) {
      await service.tick();
      expect(current(queued.id).status).toBe("failed");
      if (i < 2) await service.taskAction(queued.id, "retry");
    }
    await expect(service.taskAction(queued.id, "retry")).rejects.toThrow(
      "上限",
    );
    const other = task();
    await service.taskAction(other.id, "cancel");
    expect(current(other.id).status).toBe("cancelled");
  });
  it("persists unfinished final submits as uncertain while retaining queued work", async () => {
    await connect();
    const queued = task();
    const file = join(root, "publishing.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.tasks.push({
      ...queued,
      id: "interrupted",
      status: "publishing",
      finalSubmitted: true,
    });
    writeFileSync(file, JSON.stringify(state));
    service.close();
    service = create();
    expect(current("interrupted").status).toBe("uncertain");
    expect(current(queued.id).status).toBe("queued");
  });
  it("honors schedule, global pause and concurrent scanner exclusion", async () => {
    await connect();
    const draft = post();
    const queued = service.enqueue(draft.id, "42", "feed", now + 60_000);
    await service.tick();
    expect(current(queued.id).status).toBe("queued");
    now += 60_000;
    await service.dispatch("scheduler.pause", { paused: true });
    await service.tick();
    expect(current(queued.id).status).toBe("queued");
    await service.dispatch("scheduler.pause", { paused: false });
    await Promise.all([service.tick(), service.tick(), service.tick()]);
    expect(current(queued.id).attempts).toBe(1);
    expect(current(queued.id).status).toBe("published");
  });
  it("matches tags, respects quota/interval and supports overnight windows", async () => {
    await connect();
    post({ tags: ["其他"] });
    post();
    post();
    service.saveRule("42", {
      ...defaultRule(),
      enabled: true,
      tags: ["短剧"],
      dailyLimit: 1,
      intervalHours: 0.5,
    });
    await service.tick();
    expect(service.snapshot().tasks).toHaveLength(1);
    now += 2 * 3600_000;
    await service.tick();
    expect(service.snapshot().tasks).toHaveLength(1);
    now += 24 * 3600_000;
    await service.tick();
    expect(service.snapshot().tasks).toHaveLength(2);
    const rule = { ...defaultRule(), start: "22:00", end: "02:00" };
    expect(withinWindow(rule, new Date(2026, 9, 26, 23).getTime())).toBe(true);
    expect(withinWindow(rule, new Date(2026, 9, 27, 1).getTime())).toBe(true);
    expect(withinWindow(rule, new Date(2026, 9, 26, 12).getTime())).toBe(false);
  });
  it("polls uploaded video processing before declaring success", async () => {
    await connect();
    const queued = task({ media: [media("in.mp4")] });
    await service.tick();
    expect(current(queued.id).status).toBe("processing");
    now += 16_000;
    await service.tick();
    expect(current(queued.id).status).toBe("published");
    expect(current(queued.id).remoteId).toBe("88");
  });
  it("retains the video ID when authorization expires while processing, then resumes checking", async () => {
    await connect();
    const queued = task({ media: [media("expires.mp4")] });
    await service.tick();
    reply = () => Response.json({ error: { code: 190 } }, { status: 400 });
    now += 16_000;
    await service.tick();
    expect(current(queued.id).status).toBe("uncertain");
    expect(current(queued.id).remoteId).toBe("88");
    expect(service.snapshot().pages[0].connected).toBe(false);
    reply = originalReply;
    await connect();
    await service.taskAction(queued.id, "check");
    expect(current(queued.id).status).toBe("published");
    expect(current(queued.id).attempts).toBe(1);
  });
  it("runs all three Reels phases with an official upload host", async () => {
    await connect();
    const draft = post({ media: [media("reel.mp4")] });
    reply = async (url, init) => {
      if (url.hostname === "rupload.facebook.com") {
        for await (const _chunk of init?.body as unknown as AsyncIterable<Buffer>) {
          // Consume the mocked streaming upload as a real server would.
        }
        return { success: true };
      }
      if (url.pathname.endsWith("video_reels"))
        return (init?.body as URLSearchParams).get("upload_phase") === "start"
          ? {
              video_id: "88",
              upload_url: "https://rupload.facebook.com/video-upload/v26.0/88",
            }
          : { success: true };
      return originalReply(url);
    };
    const queued = service.enqueue(draft.id, "42", "reel", now);
    await service.tick();
    expect(current(queued.id).status).toBe("processing");
    now += 16_000;
    await service.tick();
    expect(current(queued.id).status).toBe("published");
    expect(current(queued.id).url).toBe("https://www.facebook.com/reel/88");
  });
  it("disconnects expired credentials and cancels only waiting tasks", async () => {
    await connect();
    const queued = task();
    reply = () => Response.json({ error: { code: 190 } }, { status: 400 });
    await service.tick();
    expect(current(queued.id).status).toBe("failed");
    expect(service.snapshot().pages[0].connected).toBe(false);
    expect(() => service.enqueue(post().id, "42", "feed", now)).toThrow(
      "授权未连接",
    );
    reply = originalReply;
    await connect();
    const waiting = task();
    service.disconnect("42");
    expect(current(waiting.id).status).toBe("cancelled");
  });
  it("rejects nonvideo Reels and invalid auto-publish rules", async () => {
    await connect();
    expect(() => service.enqueue(post().id, "42", "reel", now)).toThrow(
      "一个视频",
    );
    expect(() =>
      service.saveRule("42", { ...defaultRule(), enabled: true }),
    ).toThrow("标签");
    expect(() =>
      service.saveRule("42", { ...defaultRule(), start: "99:00" }),
    ).toThrow("HH:mm");
    expect(() =>
      service.saveRule("42", { ...defaultRule(), intervalHours: -1 }),
    ).toThrow("间隔");
  });
});
