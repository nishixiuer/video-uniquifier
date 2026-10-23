export type Json = Record<string, any>;
export type Method = "reels" | "native";
export type Job = {
  id: string;
  kind: string;
  mode: string;
  name: string;
  source: string;
  status: "queued" | "running" | "paused" | "success" | "failed" | "cancelled";
  progress: number;
  stage: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  params: Json;
  output: string | null;
  report: string | null;
  result: Json | null;
};
export type Profile = {
  id: string;
  name: string;
  custom: boolean;
  yaml: string;
  data: Json;
};
export type Bootstrap = {
  version: string;
  root: string;
  profiles: Profile[];
  rules: Json;
  jobs: Job[];
  tools: Record<string, boolean>;
};
export type Settings = {
  language: "zh_CN";
  theme: "dark" | "light";
  method: Method;
  reducedMotion: boolean;
};
export type ElectronAPI = {
  call: <T = unknown>(method: string, params?: object) => Promise<T>;
  pick: (
    kind?: "video" | "directory" | "image" | "font" | "config" | "history",
    multiple?: boolean,
  ) => Promise<string[]>;
  list: (path: string, recursive?: boolean) => Promise<string[]>;
  readText: (path: string) => Promise<string>;
  reveal: (path: string) => Promise<void>;
  mediaUrl: (path: string) => Promise<string>;
  readSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  onJob: (callback: (job: Job) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
};

export const terminal = (job: Job) =>
  ["success", "failed", "cancelled"].includes(job.status);
export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
export const kindLabel = (kind: string) =>
  ({
    reels: "短剧交付",
    native: "通用处理",
    qa: "质量检测",
    calibrate: "自动调参",
    corpus: "素材索引",
    variants: "实验版本",
    filequeue: "目录队列",
  })[kind] || kind;
export const statusLabel = (status: string) =>
  ({
    queued: "等待处理",
    running: "处理中",
    paused: "已暂停",
    success: "已完成",
    failed: "失败",
    cancelled: "已取消",
  })[status] || status;
export const stageLabel = (stage: string) =>
  ({
    queued: "等待处理",
    probing: "检查视频",
    processing: "视频编码",
    qa: "质量检查",
    success: "处理完成",
    failed: "处理失败",
    cancelled: "已取消",
    cancelling: "正在取消",
    interrupted: "任务中断",
    calibrating: "搜索最佳参数",
  })[stage] || (stage.startsWith("quality:") ? "生成质量报告" : "处理视频");
