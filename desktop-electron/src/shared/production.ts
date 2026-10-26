import type { AiConfig, Media } from "./publishing";

export type Material = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  active: boolean;
  video: Media;
  duration: number;
  width: number;
  height: number;
  createdAt: number;
};
export type PostSource = {
  materialId: string;
  materialName: string;
  batchId: string;
  itemId: string;
  jobId: string;
  start: number;
  end: number;
};
export type ProductionItem = {
  id: string;
  material: Material;
  start: number;
  end: number;
  status: "queued" | "video" | "copy" | "succeeded" | "failed" | "cancelled";
  progress: number;
  attempts: number;
  jobId?: string;
  output?: Media;
  copy?: string;
  postId?: string;
  error?: string;
};
export type ProductionBatch = {
  id: string;
  name: string;
  createdAt: number;
  paused: boolean;
  language: string;
  mode: "ai" | "template";
  template: { id: string; name: string; body: string };
  ai: AiConfig;
  review: "pending" | "approved";
  tags: string[];
  rules: Record<string, any>;
  items: ProductionItem[];
};
export type ProductionInput = {
  name: string;
  materialIds: string[];
  start: number;
  clipSeconds: number;
  clipsPerMaterial: number;
  strategy: "sequential" | "spread";
  language: string;
  mode: "ai" | "template";
  templateId: string;
  review: "pending" | "approved";
  tags: string[];
  rules: Record<string, any>;
};
export type ProductionSnapshot = {
  materials: Material[];
  batches: ProductionBatch[];
};
export const productionLabels: Record<ProductionItem["status"], string> = {
  queued: "等待制作",
  video: "视频制作中",
  copy: "生成推广文案",
  succeeded: "已入内容库",
  failed: "制作失败",
  cancelled: "已取消",
};
