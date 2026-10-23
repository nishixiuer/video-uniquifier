import type { Json } from "./types";

const labels: Record<string, string> = {
  source: "原始视频",
  output: "处理成片",
  video: "视频流",
  audio: "音频流",
  width: "宽度（像素）",
  height: "高度（像素）",
  duration_sec: "时长（秒）",
  codec_name: "编码格式",
  codec: "编码格式",
  fps: "帧率",
  frame_rate: "帧率",
  sample_rate: "采样率",
  channels: "声道",
  bitrate: "码率",
  bit_rate: "码率",
  size_bytes: "文件大小（字节）",
  file_size_bytes: "文件大小（字节）",
  quality_check: "交付检查",
  failures: "未通过项",
  warnings: "提示",
  findings: "检查发现",
  status: "处理状态",
  engine_version: "引擎版本",
  preset_id: "交付配置",
  elapsed_sec: "处理耗时（秒）",
  job_id: "任务编号",
  sha256: "内容指纹 SHA-256",
  filename: "文件名",
  phash_similarity: "画面指纹相似度",
  phash_distance_mean: "画面指纹平均差异",
  vmaf_mean: "VMAF 画面质量",
  ssim_mean: "SSIM 结构相似度",
  audio_fp_similarity: "音频指纹相似度",
  audio_fp_hamming_per_frame: "音频指纹帧差异",
  duration_delta_sec: "时长变化（秒）",
  av_drift_ms: "音画偏移（毫秒）",
  loudness: "响度测量",
  integrated_lufs: "综合响度（LUFS）",
  true_peak_dbtp: "真峰值（dBTP）",
  scenes: "镜头分析",
  start_sec: "起点（秒）",
  end_sec: "终点（秒）",
  count: "数量",
  notes: "说明",
  message: "说明",
  severity: "级别",
  level: "级别",
  expected_duration_sec: "预期时长（秒）",
  actual_duration_sec: "实际时长（秒）",
  aspect_ratio: "画面比例",
  pixel_format: "像素格式",
  pix_fmt: "像素格式",
  decode_ok: "解码检查",
  decode_check: "解码检查",
  passed: "是否通过",
  packaging: "画面包装",
  title: "标题",
  logo: "标志图层",
  video_encode_passes: "视频编码次数",
  encode_attempts: "编码尝试次数",
  black_segments: "黑场片段",
  silence_segments: "静音片段",
  scene_count: "镜头数量",
  source_sha256: "原始内容指纹",
  output_sha256: "成片内容指纹",
  size: "大小",
  path: "文件位置",
  format_name: "容器格式",
  faststart: "快速起播",
  schema_version: "报告版本",
  plan_hash: "处理计划指纹",
  input_md5: "原片内容指纹",
  output_md5: "成片内容指纹",
  input_size_bytes: "原片大小（字节）",
  output_size_bytes: "成片大小（字节）",
  input_duration_sec: "原片时长（秒）",
  output_duration_sec: "成片时长（秒）",
  duration_match: "时长是否符合",
  phash_samples: "画面采样数",
  phash_distance_min: "画面最小指纹差异",
  phash_distance_max: "画面最大指纹差异",
  audio_fp_match_confidence: "音频指纹匹配置信度",
  audio_fp_hamming_per_window: "分窗音频指纹差异",
  audio_fp_hamming_variance: "音频指纹差异方差",
  cid_predict_self: "本地自相似度（非平台预测）",
  weakest_chunk_sec: "最相似片段时间",
  corpus_matches: "参考素材匹配",
  sscd_mean: "SSCD 均值（可选指标）",
  sscd_min: "SSCD 最小值（可选指标）",
  sscd_per_frame: "SSCD 分帧结果",
  vmaf_registered_mean: "对齐后 VMAF 质量",
  ssim_registered_mean: "对齐后 SSIM 相似度",
  sscd_registered_mean: "对齐后 SSCD 相似度",
  audio_fp_registered_hamming_per_frame: "对齐后音频指纹差异",
  registration: "画面时间对齐",
  correctness: "成片完整性",
  quality_policy: "质量标准",
  gates_enforced: "强制执行交付检查",
  decode: "完整解码检查",
  timing: "音画同步",
  start_drift_ms: "起点音画偏移（毫秒）",
  end_drift_ms: "终点音画偏移（毫秒）",
  listening_review: "听感检查",
  subtitle_review: "字幕检查",
  visual_similarity: "画面相似度",
  reason: "原因",
  platform_originality: "平台原创性",
  streams: "音频流测量",
  stream_index: "音轨编号",
  index: "流编号",
  channel_layout: "声道布局",
  color: "色彩信息",
  is_hdr: "是否为 HDR",
  primaries: "原色标准",
  transfer: "传递曲线",
  matrix: "矩阵系数",
  range: "色彩范围",
  container: "封装格式",
  variable_frame_rate: "可变帧率",
  black_intervals: "黑场时间段",
  silence_intervals: "静音时间段",
  edits_applied: "是否自动剪辑",
  cadence: "帧率检查",
  source_timeline: "原始镜头时间线",
  output_timeline: "成片镜头时间线",
  scene_id: "镜头编号",
  source_start_sec: "原片起点（秒）",
  source_end_sec: "原片终点（秒）",
  audio_state: "音频处理状态",
};
const values: Record<string, string> = {
  success: "通过",
  failed: "未通过",
  cancelled: "已取消",
  warning: "提示",
  info: "信息",
  pass: "通过",
  fail: "未通过",
  measured: "已测量",
  skipped: "已跳过",
  silent: "无音轨",
  not_available: "不可用",
  passed: "通过",
  not_requested: "未启用",
  not_computed: "未测量",
  not_assessed: "未评估",
  manual_required: "需人工检查",
  missing: "无音轨",
  disabled: "已关闭",
  "Reframed output has no registered reference.":
    "画面重新构图后没有对齐参考，不直接计算画面相似度。",
};
const hidden = new Set([
  "execution_argv",
  "native_profile",
  "effective_rules",
  "chunk_similarities",
  "phash_frames",
  "audio_fingerprint",
  "previews",
]);
export type ReportRow = {
  key: string;
  group: string;
  label: string;
  value: string;
};
export function reportRows(report: Json): ReportRow[] {
  const rows: ReportRow[] = [];
  function visit(value: unknown, path: string[], group: string) {
    const key = path[path.length - 1] || "报告";
    if (hidden.has(key)) return;
    const label = labels[key] || key.replaceAll("_", " ");
    if (value === null || value === undefined || typeof value !== "object") {
      const display =
        value == null
          ? "未测量"
          : typeof value === "boolean"
            ? value
              ? "是"
              : "否"
            : typeof value === "number"
              ? Number.isInteger(value)
                ? String(value)
                : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
              : values[String(value)] || String(value);
      rows.push({ key: path.join("."), group, label, value: display });
      return;
    }
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index + 1), item] as const)
      : Object.entries(value);
    if (!entries.length)
      rows.push({
        key: path.join("."),
        group,
        label,
        value: key === "failures" ? "全部通过" : "无",
      });
    else
      entries
        .slice(0, 100)
        .forEach(([name, item]) =>
          visit(item, [...path, name], path.length <= 1 ? label : group),
        );
  }
  Object.entries(report).forEach(([key, value]) =>
    visit(value, [key], labels[key] || "处理信息"),
  );
  return rows;
}
