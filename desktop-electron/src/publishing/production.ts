import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import type {
  AiConfig,
  CopyTemplate,
  GenerationInput,
  Media,
  Post,
} from "../shared/publishing";
import type {
  Material,
  PostSource,
  ProductionBatch,
  ProductionInput,
  ProductionItem,
  ProductionSnapshot,
} from "../shared/production";

type EngineJob = {
  id: string;
  status: string;
  progress: number;
  output?: string;
  error?: string;
};
type Context = Pick<
  GenerationInput,
  "title" | "description" | "language" | "tags"
>;
export type ProductionOptions = {
  root: string;
  engine?: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  importMedia: (paths: string[]) => Media[];
  templates: () => CopyTemplate[];
  freezeAi: (batchId: string, mode: "ai" | "template") => AiConfig;
  generateCopy: (
    batch: ProductionBatch,
    context: Context,
    index: number,
    signal: AbortSignal,
  ) => Promise<string>;
  createPost: (input: Record<string, unknown>, source: PostSource) => Post;
  now: () => number;
};
const number = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`数值必须在 ${min} 到 ${max} 之间。`);
  return value;
};
const string = (value: unknown, max = 20000) => {
  if (typeof value !== "string" || value.length > max)
    throw new Error("资料文本无效或过长。");
  return value.trim();
};
const tagList = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error("标签数量不能超过 50 个。");
  return [...new Set(value.map((item) => string(item, 100)).filter(Boolean))];
};

/** Deterministic, non-overlapping clip ranges; a single short source may use its full duration. */
export function planClips(
  duration: number,
  start: number,
  seconds: number,
  count: number,
  strategy: string,
) {
  number(duration, 0.001, 86400);
  number(start, 0, duration - 0.001);
  number(seconds, 0.1, 3600);
  number(count, 1, 50);
  if (!Number.isInteger(count) || !["sequential", "spread"].includes(strategy))
    throw new Error("剪片数量或选段方式无效。");
  const length = Math.min(seconds, duration - start);
  if (length * count > duration - start + 0.0001)
    throw new Error("视频时长不足，请减少片段数量、缩短每段时长或调整起点。");
  const step =
    strategy === "spread" && count > 1
      ? (duration - start - length) / (count - 1)
      : length;
  return Array.from({ length: count }, (_, index) => ({
    start: Math.round((start + index * step) * 1000) / 1000,
    end:
      Math.round(Math.min(duration, start + index * step + length) * 1000) /
      1000,
  }));
}

export class ProductionService {
  private state: ProductionSnapshot;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private closed = false;
  private controller?: AbortController;
  private activeId?: string;
  constructor(private options: ProductionOptions) {
    mkdirSync(options.root, { recursive: true });
    const path = join(options.root, "production.json");
    this.state = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { materials: [], batches: [] };
    for (const batch of this.state.batches)
      for (const item of batch.items)
        if (item.status === "copy") item.status = "queued";
    this.save();
  }
  private save() {
    const path = join(this.options.root, "production.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
    });
    renameSync(`${path}.tmp`, path);
  }
  snapshot() {
    return structuredClone(this.state);
  }
  sourceEnabled(source?: Pick<PostSource, "materialId">) {
    return (
      !source ||
      this.state.materials.some(
        (material) => material.id === source.materialId && material.active,
      )
    );
  }
  private engine<T>(method: string, params: Record<string, unknown> = {}) {
    if (!this.options.engine)
      throw new Error("视频引擎尚未连接，请重新启动应用。");
    return this.options.engine<T>(method, params);
  }
  async importMaterials(paths: string[], info: Record<string, unknown> = {}) {
    // Imports are validated and copied by the existing managed-media boundary.
    const media = this.options.importMedia(paths);
    const added: Material[] = [];
    const errors: string[] = [];
    for (const video of media) {
      try {
        if (video.kind !== "video") throw new Error("素材库请选择视频文件。");
        if (
          ![".mp4", ".mov", ".mkv", ".webm"].includes(
            extname(video.path).toLowerCase(),
          )
        )
          throw new Error(
            "自动剪片支持 MP4、MOV、MKV、WebM，请先转换视频格式。",
          );
        const probe = await this.engine<{
          duration_sec: number;
          video: { width: number; height: number; is_default?: boolean }[];
        }>("probe", { path: video.path });
        number(probe.duration_sec, 0.1, 86400);
        const stream =
          probe.video.find((value) => value.is_default) || probe.video[0];
        if (!stream) throw new Error("文件没有可用的视频轨道。");
        const material: Material = {
          id: randomUUID(),
          name: video.name.replace(/\.[^.]+$/, ""),
          description: string(info.description ?? ""),
          category: string(info.category ?? "", 100),
          tags: tagList(info.tags ?? []),
          active: true,
          video,
          duration: probe.duration_sec,
          width: stream.width,
          height: stream.height,
          createdAt: this.options.now(),
        };
        this.state.materials.unshift(material);
        added.push(material);
        this.save();
      } catch (error) {
        errors.push(
          `${video.name}：${error instanceof Error ? error.message : "导入失败"}`,
        );
      }
    }
    return { added: structuredClone(added), errors };
  }
  updateMaterial(input: Record<string, unknown>) {
    const material = this.state.materials.find(
      (value) => value.id === input.id,
    );
    if (!material) throw new Error("素材不存在。");
    const name = string(input.name, 200);
    if (!name) throw new Error("请填写素材名称。");
    const changes = {
      name,
      description: string(input.description),
      category: string(input.category, 100),
      tags: tagList(input.tags),
      active: Boolean(input.active),
    };
    Object.assign(material, changes);
    this.save();
  }
  removeMaterial(id: string) {
    if (
      this.state.batches.some((batch) =>
        batch.items.some((item) => item.material.id === id),
      )
    )
      throw new Error("素材已关联制作记录，请停用以保留来源追溯。");
    this.state.materials = this.state.materials.filter(
      (material) => material.id !== id,
    );
    this.save();
  }
  private plan(input: ProductionInput) {
    if (
      !Array.isArray(input.materialIds) ||
      !input.materialIds.length ||
      input.materialIds.length > 100
    )
      throw new Error("请选择 1–100 个素材。");
    const plan: { material: Material; start: number; end: number }[] = [];
    for (const id of new Set(input.materialIds)) {
      const material = this.state.materials.find((entry) => entry.id === id);
      if (!material?.active || !existsSync(material.video.path))
        throw new Error("素材已停用、丢失或不存在。");
      if (!material.description)
        throw new Error(`请先完善“${material.name}”的视频介绍/推广资料。`);
      for (const range of planClips(
        material.duration,
        input.start,
        input.clipSeconds,
        input.clipsPerMaterial,
        input.strategy,
      )) {
        const reserved = this.state.batches.some((batch) =>
          batch.items.some(
            (item) =>
              item.material.id === id &&
              item.status !== "cancelled" &&
              Math.abs(item.start - range.start) < 0.001 &&
              Math.abs(item.end - range.end) < 0.001,
          ),
        );
        if (reserved)
          throw new Error(
            `“${material.name}”的 ${range.start}–${range.end} 秒已创建制作任务，请重试原任务或调整区间。`,
          );
        plan.push({ material: structuredClone(material), ...range });
      }
    }
    if (plan.length > 100) throw new Error("每批最多制作 100 条内容。");
    return plan;
  }
  preview(input: ProductionInput) {
    return this.plan(input);
  }
  async createBatch(input: ProductionInput) {
    const plan = this.plan(input);
    const template = this.options
      .templates()
      .find((entry) => entry.id === input.templateId);
    if (!template) throw new Error("请选择有效提示词模板。");
    if (
      !["ai", "template"].includes(input.mode) ||
      !["pending", "approved"].includes(input.review)
    )
      throw new Error("生成方式或审核状态无效。");
    const name =
      string(input.name, 200) ||
      `批量制作 ${new Date(this.options.now()).toLocaleString("zh-CN")}`;
    const language = string(input.language, 50);
    if (!language) throw new Error("请选择生成语种。");
    const tags = tagList(input.tags);
    const rules = await this.engine<Record<string, any>>("config.validate", {
      kind: "reels",
      yaml: JSON.stringify(input.rules),
    });
    if (rules.packaging?.logo?.enabled || rules.packaging?.title?.enabled)
      throw new Error(
        "批量制作暂不支持引用外部 Logo/字体；请在独立视频工具中处理包装。",
      );
    // Re-check after asynchronous validation so simultaneous requests cannot reserve the same range.
    this.plan(input);
    const id = randomUUID();
    const batch: ProductionBatch = {
      id,
      name,
      language,
      mode: input.mode,
      review: input.review,
      tags,
      rules,
      template: structuredClone(template),
      ai: this.options.freezeAi(id, input.mode),
      createdAt: this.options.now(),
      paused: false,
      items: plan.map((entry) => ({
        ...entry,
        id: randomUUID(),
        status: "queued",
        progress: 0,
        attempts: 1,
      })),
    };
    this.state.batches.unshift(batch);
    this.save();
    return structuredClone(batch);
  }
  async action(batchId: string, action: string, itemId?: string) {
    const batch = this.state.batches.find((entry) => entry.id === batchId);
    if (!batch) throw new Error("制作批次不存在。");
    if (action === "pause" || action === "resume")
      batch.paused = action === "pause";
    else if (action === "retry" || action === "cancel") {
      const targets = batch.items.filter(
        (item) => !itemId || item.id === itemId,
      );
      if (!targets.length) throw new Error("制作项不存在。");
      const cancelJobs: string[] = [];
      for (const item of targets) {
        if (action === "retry" && item.status === "failed") {
          item.status = "queued";
          item.error = undefined;
          if (!item.output && item.jobId) {
            item.jobId = undefined;
            item.attempts++;
          }
        } else if (
          action === "cancel" &&
          !["succeeded", "failed", "cancelled"].includes(item.status)
        ) {
          item.status = "cancelled";
          if (item.id === this.activeId) this.controller?.abort();
          if (item.jobId) cancelJobs.push(item.jobId);
        }
      }
      this.save();
      await Promise.allSettled(
        cancelJobs.map((id) =>
          this.engine("jobs.action", { id, action: "cancel" }),
        ),
      );
    } else throw new Error("不支持的制作操作。");
    this.save();
  }
  start() {
    if (!this.timer)
      this.timer = setInterval(() => {
        void this.tick();
      }, 1000);
  }
  close() {
    this.closed = true;
    this.controller?.abort();
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.busy || this.closed) return;
    const batch = [...this.state.batches]
      .reverse()
      .find(
        (entry) =>
          !entry.paused &&
          entry.items.some((item) =>
            ["queued", "video", "copy"].includes(item.status),
          ),
      );
    const item = batch?.items.find((entry) =>
      ["queued", "video", "copy"].includes(entry.status),
    );
    if (!batch || !item) return;
    this.busy = true;
    this.activeId = item.id;
    try {
      if (!this.sourceEnabled({ materialId: item.material.id }))
        throw new Error("来源素材已停用，请启用后重试。");
      if (!item.output) {
        if (!item.jobId) {
          item.status = "video";
          this.save();
          const rules = structuredClone(batch.rules);
          rules.scenes = {
            ...rules.scenes,
            trim_start_sec: item.start,
            trim_end_sec: Math.max(0, item.material.duration - item.end),
          };
          const job = await this.engine<EngineJob>("jobs.submit", {
            kind: "reels",
            source: item.material.video.path,
            rules,
            mode: "export",
            request_key: `${item.id}:${item.attempts}`,
          });
          if (this.closed || (item as ProductionItem).status === "cancelled") {
            await this.engine("jobs.action", { id: job.id, action: "cancel" });
            return;
          }
          item.jobId = job.id;
          item.status = "video";
          this.save();
        }
        const jobs = await this.engine<EngineJob[]>("jobs.list");
        if (this.closed || (item as ProductionItem).status === "cancelled")
          return;
        const job = jobs.find((entry) => entry.id === item.jobId);
        if (!job) throw new Error("视频任务记录丢失，请重试制作项。");
        item.progress = Math.round((job.progress || 0) * 75);
        if (["failed", "cancelled"].includes(job.status))
          throw new Error(job.error || "视频任务已中断，请重试。");
        if (job.status !== "success") return;
        if (!job.output) throw new Error("视频处理完成但没有成片。");
        item.output = this.options.importMedia([job.output])[0];
        this.save();
      }
      if (this.closed || (item as ProductionItem).status === "cancelled")
        return;
      if (!item.copy) {
        item.status = "copy";
        item.progress = 80;
        this.save();
        this.controller = new AbortController();
        const description = `${item.material.description}\n分类：${item.material.category || "未分类"}\n本条片段：${item.start}–${item.end} 秒\n源视频时长：${item.material.duration} 秒；画面：${item.material.width}×${item.material.height}\n请根据资料撰写推广文案，不要编造片段中未提供的剧情。`;
        const copy = await this.options.generateCopy(
          batch,
          {
            title: item.material.name,
            description,
            language: batch.language,
            tags: [
              ...new Set(
                [
                  ...item.material.tags,
                  ...batch.tags,
                  item.material.category,
                ].filter(Boolean),
              ),
            ],
          },
          batch.items.indexOf(item) + 1,
          this.controller.signal,
        );
        if (this.closed || (item as ProductionItem).status === "cancelled")
          return;
        item.copy = copy;
        this.save();
      }
      const source: PostSource = {
        materialId: item.material.id,
        materialName: item.material.name,
        batchId: batch.id,
        itemId: item.id,
        jobId: item.jobId!,
        start: item.start,
        end: item.end,
      };
      const post = this.options.createPost(
        {
          title: `${item.material.name} · ${item.start}–${item.end} 秒`,
          copy: item.copy,
          media: [item.output],
          language: batch.language,
          review: batch.review,
          tags: [
            ...new Set(
              [
                ...item.material.tags,
                ...batch.tags,
                item.material.category,
              ].filter(Boolean),
            ),
          ],
        },
        source,
      );
      item.postId = post.id;
      item.status = "succeeded";
      item.progress = 100;
      item.error = undefined;
    } catch (error) {
      if (!this.closed && item.status !== "cancelled") {
        item.status = "failed";
        item.error =
          error instanceof Error ? error.message : "制作失败，请重试。";
      }
    } finally {
      this.save();
      this.busy = false;
      this.activeId = undefined;
      this.controller = undefined;
    }
  }
}
