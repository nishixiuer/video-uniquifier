import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublishingService } from "./service";
import { planClips } from "./production";
import type { ProductionInput } from "../shared/production";
import { defaultRule } from "../shared/publishing";

let root: string;
let service: PublishingService;
let request: ReturnType<typeof vi.fn>;
let engine: ReturnType<typeof vi.fn>;
let videoStatus: string;
let jobs: Map<string, any>;
let now: number;
function create() {
  return new PublishingService({
    root,
    allowed: (path) => path,
    secure: () => true,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString(),
    open: async () => {},
    fetch: request as typeof fetch,
    engine: engine as any,
    now: () => now,
  });
}
const input = (
  materialIds: string[],
  extra: Partial<ProductionInput> = {},
): ProductionInput => ({
  materialIds,
  name: "测试制作",
  start: 0,
  clipSeconds: 10,
  clipsPerMaterial: 2,
  strategy: "sequential",
  language: "简体中文",
  mode: "ai",
  templateId: "default",
  review: "pending",
  tags: ["推广"],
  rules: {
    video: { width: 720, height: 1280 },
    scenes: { detect_enabled: false },
  },
  ...extra,
});
async function material(name = "源视频.mp4") {
  const path = join(root, name);
  writeFileSync(path, "source");
  const { added } = await service.production.importMaterials([path]);
  service.production.updateMaterial({
    ...added[0],
    name,
    description: `${name}剧情资料`,
    category: "短剧",
    tags: ["情感"],
  });
  return service.snapshot().materials[0];
}
async function batch(extra: Partial<ProductionInput> = {}) {
  const source = await material();
  return service.production.createBatch(input([source.id], extra));
}
const current = (id: string) =>
  service.snapshot().batches.find((batch) => batch.id === id)!;
async function drain() {
  for (let i = 0; i < 30; i++) {
    await service.production.tick();
    if (
      !service
        .snapshot()
        .batches.some((batch) =>
          batch.items.some((item) =>
            ["queued", "video", "copy"].includes(item.status),
          ),
        )
    )
      return;
  }
  throw new Error("制作队列没有收尾");
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "production-unit-"));
  jobs = new Map();
  videoStatus = "success";
  now = new Date(2026, 9, 26, 12).getTime();
  request = vi.fn(async () =>
    Response.json({
      choices: [{ message: { content: "根据视频资料生成的推广文案" } }],
    }),
  );
  engine = vi.fn(async (method: string, params: any = {}) => {
    if (method === "probe")
      return { duration_sec: 60, video: [{ width: 720, height: 1280 }] };
    if (method === "config.validate")
      return { ...JSON.parse(params.yaml), scenes: {}, packaging: {} };
    if (method === "jobs.submit") {
      if (jobs.has(params.request_key)) return jobs.get(params.request_key);
      const output = join(root, `成片-${jobs.size}.mp4`);
      writeFileSync(output, "produced");
      const job = {
        id: `job-${jobs.size}`,
        output,
        status: videoStatus,
        progress: 1,
        params,
        error: videoStatus === "failed" ? "视频编码失败" : undefined,
      };
      jobs.set(params.request_key, job);
      return job;
    }
    if (method === "jobs.list") return [...jobs.values()];
    if (method === "jobs.action") {
      const job = [...jobs.values()].find((job) => job.id === params.id);
      if (job) job.status = "cancelled";
      return job;
    }
    throw new Error(`Unexpected engine call: ${method}`);
  });
  service = create();
  service.configureAi({
    baseUrl: "http://localhost:8888/v1",
    model: "original-model",
    key: "PRIVATE_KEY",
  });
});
afterEach(() => {
  service.close();
  rmSync(root, { recursive: true, force: true });
});

describe("clip planning", () => {
  it("creates sequential and evenly distributed non-overlapping ranges", () => {
    expect(planClips(60, 5, 10, 3, "sequential")).toEqual([
      { start: 5, end: 15 },
      { start: 15, end: 25 },
      { start: 25, end: 35 },
    ]);
    expect(planClips(60, 0, 10, 3, "spread")).toEqual([
      { start: 0, end: 10 },
      { start: 25, end: 35 },
      { start: 50, end: 60 },
    ]);
    expect(planClips(5, 1, 30, 1, "sequential")).toEqual([
      { start: 1, end: 5 },
    ]);
  });
  it.each([
    [10, 0, 10, 2, "sequential"],
    [60, 60, 10, 1, "spread"],
    [60, 0, 10, 1.2, "spread"],
    [60, 0, Infinity, 1, "spread"],
    [60, 0, 10, 1, "random"],
  ])("rejects invalid/oversubscribed plans %j", (...args) => {
    expect(() =>
      planClips(...(args as [number, number, number, number, string])),
    ).toThrow();
  });
});

describe("material-to-content production", () => {
  it("imports managed video, records real probe metadata and requires source information", async () => {
    const path = join(root, "尚无介绍.mp4");
    writeFileSync(path, "video");
    const result = await service.production.importMaterials([path]);
    expect(result.errors).toEqual([]);
    expect(result.added[0].duration).toBe(60);
    expect(result.added[0].video.path).not.toBe(path);
    expect(() =>
      service.production.preview(input([result.added[0].id])),
    ).toThrow("完善");
    engine.mockRejectedValueOnce(new Error("无法探测"));
    const failed = await service.production.importMaterials([path]);
    expect(failed.added).toHaveLength(0);
    expect(failed.errors[0]).toContain("无法探测");
    const unsupported = join(root, "legacy.avi");
    writeFileSync(unsupported, "video");
    expect(
      (await service.production.importMaterials([unsupported])).errors[0],
    ).toContain("转换视频格式");
  });
  it("creates cropped video + per-source AI copy + provenance and inherits tags", async () => {
    const created = await batch();
    await drain();
    expect(service.snapshot().posts).toHaveLength(2);
    const post = service
      .snapshot()
      .posts.find((post) => post.source?.start === 10)!;
    expect(post.source).toMatchObject({
      batchId: created.id,
      start: 10,
      end: 20,
    });
    expect(post.tags).toEqual(["情感", "推广", "短剧"]);
    expect(post.review).toBe("pending");
    expect(post.copy).toContain("推广文案");
    const jobsParams = [...jobs.values()].map((job) => job.params);
    expect(jobsParams[0].rules.scenes).toMatchObject({
      trim_start_sec: 0,
      trim_end_sec: 50,
    });
    expect(jobsParams[1].rules.scenes).toMatchObject({
      trim_start_sec: 10,
      trim_end_sec: 40,
    });
    const prompt = JSON.parse(request.mock.calls[1][1].body);
    expect(prompt.messages[1].content).toContain("10–20 秒");
    expect(prompt.messages[1].content).toContain("源视频.mp4剧情资料");
    expect(
      current(created.id).items.every((item) => item.status === "succeeded"),
    ).toBe(true);
    expect(JSON.stringify(service.snapshot())).not.toContain("PRIVATE_KEY");
    expect(readFileSync(join(root, "production.json"), "utf8")).not.toContain(
      "PRIVATE_KEY",
    );
  });
  it("freezes source, prompt, endpoint, model and encrypted AI key for the batch", async () => {
    const created = await batch({ clipsPerMaterial: 1 });
    const source = service.snapshot().materials[0];
    service.production.updateMaterial({
      ...source,
      description: "后续修改的剧情",
    });
    service.configureAi({
      baseUrl: "http://localhost:9999/v1",
      model: "changed",
      key: "NEW_KEY",
    });
    service.saveTemplate({ id: "default", name: "新模板", body: "新模板正文" });
    await drain();
    expect(request.mock.calls[0][0]).toBe(
      "http://localhost:8888/v1/chat/completions",
    );
    const init = request.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer PRIVATE_KEY");
    expect(JSON.parse(init.body).model).toBe("original-model");
    expect(init.body).not.toContain("后续修改的剧情");
    expect(current(created.id).template.body).not.toBe("新模板正文");
  });
  it("prevents concurrent duplicate reservations and validates schema before creating a batch", async () => {
    const source = await material();
    const results = await Promise.allSettled([
      service.production.createBatch(input([source.id])),
      service.production.createBatch(input([source.id])),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(service.snapshot().batches).toHaveLength(1);
    await expect(
      service.production.createBatch(input([source.id])),
    ).rejects.toThrow("已创建");
    engine.mockRejectedValueOnce(new Error("Schema 错误"));
    await expect(
      service.production.createBatch(input([source.id], { start: 30 })),
    ).rejects.toThrow("Schema");
    expect(service.snapshot().batches).toHaveLength(1);
  });
  it("retains successful items and retries AI failures without re-encoding", async () => {
    request.mockResolvedValueOnce(
      Response.json({ error: "failed" }, { status: 500 }),
    );
    const created = await batch();
    await drain();
    expect(current(created.id).items.map((item) => item.status)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(service.snapshot().posts).toHaveLength(1);
    expect(jobs.size).toBe(2);
    await service.production.action(created.id, "retry");
    await drain();
    expect(service.snapshot().posts).toHaveLength(2);
    expect(jobs.size).toBe(2);
    expect(
      current(created.id).items.every((item) => item.status === "succeeded"),
    ).toBe(true);
  });
  it("keeps paused work and resumes video binding after restart", async () => {
    videoStatus = "running";
    const created = await batch({ clipsPerMaterial: 1 });
    await service.production.tick();
    expect(current(created.id).items[0].status).toBe("video");
    await service.production.action(created.id, "pause");
    service.close();
    service = create();
    await service.production.tick();
    expect(service.snapshot().posts).toHaveLength(0);
    [...jobs.values()][0].status = "success";
    await service.production.action(created.id, "resume");
    await drain();
    expect(jobs.size).toBe(1);
    expect(service.snapshot().posts).toHaveLength(1);
    service.close();
    service = create();
    await service.production.tick();
    expect(service.snapshot().posts).toHaveLength(1);
  });
  it("recovers an unacknowledged submit with the same request key", async () => {
    const original = engine.getMockImplementation()!;
    let loseResponse = true;
    engine.mockImplementation(async (method: string, params: any) => {
      const result = await original(method, params);
      if (method === "jobs.submit" && loseResponse) {
        loseResponse = false;
        throw new Error("提交响应中断");
      }
      return result;
    });
    const created = await batch({ clipsPerMaterial: 1 });
    await drain();
    expect(current(created.id).items[0].status).toBe("failed");
    service.close();
    service = create();
    await service.production.action(created.id, "retry");
    await drain();
    expect(jobs.size).toBe(1);
    expect(service.snapshot().posts).toHaveLength(1);
  });
  it("retries interrupted/failed encoding and cancels queued work durably", async () => {
    videoStatus = "failed";
    const created = await batch();
    await drain();
    expect(service.snapshot().posts).toHaveLength(0);
    videoStatus = "success";
    await service.production.action(created.id, "retry", created.items[0].id);
    await drain();
    expect(service.snapshot().posts).toHaveLength(1);
    const source = service.snapshot().materials[0];
    const other = await service.production.createBatch(
      input([source.id], { start: 30 }),
    );
    await service.production.action(other.id, "cancel");
    service.close();
    service = create();
    expect(
      current(other.id).items.every((item) => item.status === "cancelled"),
    ).toBe(true);
  });
  it("runs offline templates without AI and forbids publishing a disabled source", async () => {
    const created = await batch({
      mode: "template",
      clipsPerMaterial: 1,
      review: "approved",
    });
    await drain();
    expect(request).not.toHaveBeenCalled();
    const post = service.snapshot().posts[0];
    expect(post.source?.batchId).toBe(created.id);
    service.configureApp({
      appId: "123",
      secret: "secret",
      version: "v26.0",
      redirectUri: "http://localhost:47135/facebook/callback",
    });
    request.mockImplementation(async (url: string) =>
      Response.json(
        new URL(String(url)).pathname.endsWith("permissions")
          ? {
              data: [
                "pages_show_list",
                "pages_read_engagement",
                "pages_manage_posts",
              ].map((permission) => ({ permission, status: "granted" })),
            }
          : {
              data: [
                {
                  id: "42",
                  name: "测试主页",
                  access_token: "token",
                  tasks: ["CREATE_CONTENT"],
                },
              ],
            },
      ),
    );
    await service.connectPages("token");
    service.saveRule("42", { ...defaultRule(), enabled: true, tags: ["短剧"] });
    const source = service.snapshot().materials[0];
    service.production.updateMaterial({ ...source, active: false });
    expect(() => service.enqueue(post.id, "42", "feed", now)).toThrow("停用");
    await service.tick();
    expect(service.snapshot().tasks).toHaveLength(0);
    expect(() => service.production.removeMaterial(source.id)).toThrow("追溯");
    service.production.updateMaterial({ ...source, active: true });
    // Explicitly enqueue before disabling again: existing waiting work must also respect source state.
    const task = service.enqueue(post.id, "42", "feed", now);
    service.production.updateMaterial({ ...source, active: false });
    await service.tick();
    expect(
      service.snapshot().tasks.find((entry) => entry.id === task.id)?.attempts,
    ).toBe(0);
  });
  it("cancels an in-flight AI request without creating publishable content", async () => {
    request.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const created = await batch({ clipsPerMaterial: 1 });
    const work = service.production.tick();
    await vi.waitFor(() =>
      expect(current(created.id).items[0].status).toBe("copy"),
    );
    await service.production.action(created.id, "cancel", created.items[0].id);
    await work;
    expect(current(created.id).items[0].status).toBe("cancelled");
    expect(service.snapshot().posts).toHaveLength(0);
    service.close();
    service = create();
    expect(current(created.id).items[0].status).toBe("cancelled");
  });
  it("recovers an interrupted AI stage without encoding the video twice", async () => {
    request.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const created = await batch({ clipsPerMaterial: 1 });
    const work = service.production.tick();
    await vi.waitFor(() =>
      expect(current(created.id).items[0].status).toBe("copy"),
    );
    service.close();
    await work;
    request.mockImplementation(async () =>
      Response.json({ choices: [{ message: { content: "恢复后的文案" } }] }),
    );
    service = create();
    await drain();
    expect(jobs.size).toBe(1);
    expect(service.snapshot().posts).toHaveLength(1);
    expect(service.snapshot().posts[0].copy).toBe("恢复后的文案");
  });
  it("assigns generated approved content to matching pages once, oldest first", async () => {
    const created = await batch({
      mode: "template",
      clipsPerMaterial: 3,
      review: "approved",
    });
    await drain();
    service.configureApp({
      appId: "123",
      secret: "secret",
      version: "v26.0",
      redirectUri: "http://localhost:47135/facebook/callback",
    });
    request.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      return Response.json(
        path.endsWith("permissions")
          ? {
              data: [
                "pages_show_list",
                "pages_read_engagement",
                "pages_manage_posts",
              ].map((permission) => ({ permission, status: "granted" })),
            }
          : path.endsWith("accounts")
            ? {
                data: ["42", "43"].map((id) => ({
                  id,
                  name: `主页${id}`,
                  access_token: "test-token",
                  tasks: ["CREATE_CONTENT"],
                })),
              }
            : { id: "88" },
      );
    });
    await service.connectPages("test-token");
    for (const id of ["42", "43"])
      service.saveRule(id, { ...defaultRule(), enabled: true, tags: ["短剧"] });
    await service.tick();
    const tasks = service.snapshot().tasks;
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.postId)).size).toBe(2);
    expect(new Set(tasks.map((task) => task.pageId)).size).toBe(2);
    expect(new Set(tasks.map((task) => task.snapshot.source?.itemId))).toEqual(
      new Set(created.items.slice(0, 2).map((item) => item.id)),
    );
    expect(
      service
        .snapshot()
        .posts.filter((post) => !tasks.some((task) => task.postId === post.id)),
    ).toHaveLength(1);
  });
});
