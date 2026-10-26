import type { PostSource, ProductionSnapshot } from "./production";

export type Media = {
  id: string;
  path: string;
  name: string;
  kind: "image" | "video";
  size: number;
  source: string;
};
export type Post = {
  id: string;
  title: string;
  copy: string;
  language: string;
  tags: string[];
  media: Media[];
  review: "pending" | "approved";
  createdAt: number;
  updatedAt: number;
  source?: PostSource;
};
export type PageRule = {
  enabled: boolean;
  tags: string[];
  dailyLimit: number;
  intervalHours: number;
  start: string;
  end: string;
  format: "feed" | "reel";
};
export type FacebookPage = {
  id: string;
  name: string;
  category?: string;
  tasks: string[];
  connectedAt: number;
  connected: boolean;
  rule: PageRule;
};
export type PublishTask = {
  id: string;
  postId: string;
  pageId: string;
  snapshot: Post;
  format: "feed" | "reel";
  status:
    | "queued"
    | "publishing"
    | "processing"
    | "published"
    | "failed"
    | "uncertain"
    | "cancelled";
  scheduledAt: number;
  createdAt: number;
  startedAt?: number;
  publishedAt?: number;
  attempts: number;
  error?: string;
  remoteId?: string;
  url?: string;
  photoIds: string[];
  finalSubmitted?: boolean;
  retryAt?: number;
};
export type CopyTemplate = { id: string; name: string; body: string };
export type AppConfig = {
  appId: string;
  version: string;
  redirectUri: string;
  hasSecret: boolean;
  localCallback?: { previousRedirectUri: string };
};
export type AiConfig = { baseUrl: string; model: string; hasKey: boolean };
export type PublishingSnapshot = ProductionSnapshot & {
  posts: Post[];
  pages: FacebookPage[];
  tasks: PublishTask[];
  templates: CopyTemplate[];
  app: AppConfig;
  ai: AiConfig;
  paused: boolean;
  authorization: {
    status: string;
    message: string;
    expiresAt?: number;
    url?: string;
  };
  secureStorage: boolean;
};
export type GenerationInput = {
  title: string;
  description: string;
  language: string;
  tags: string[];
  quantity: number;
  templateId: string;
  mode: "template" | "ai";
  media: Media[];
  imagesPerPost: number;
};
export const defaultRule = (): PageRule => ({
  enabled: false,
  tags: [],
  dailyLimit: 5,
  intervalHours: 1,
  start: "00:00",
  end: "23:59",
  format: "feed",
});
export const taskLabels: Record<PublishTask["status"], string> = {
  queued: "待发布",
  publishing: "上传并发布中",
  processing: "平台处理中",
  published: "已发布",
  failed: "发布失败",
  uncertain: "需核实发布结果",
  cancelled: "已取消",
};
