import type { Job, Json } from "./types";

export type ComparisonData = {
  source: Json;
  output: Json;
  report: Json;
  notices: string[];
};
type Request = (method: string, params: object) => Promise<Json>;

/** Use saved measurements first; legacy/native reports need a lightweight probe. */
export async function loadComparison(
  job: Job,
  request: Request,
  savedReport?: Json,
): Promise<ComparisonData> {
  const notices: string[] = [];
  let report = savedReport;
  if (!report && job.report) {
    try {
      report = await request("report.read", { id: job.id });
    } catch {
      notices.push(
        "原质量报告无法读取，改为读取本地视频参数；响度等报告测量值可能不可用。",
      );
    }
  }
  report ??= {};
  const paths = { source: job.source, output: job.output };
  const results = await Promise.all(
    (["source", "output"] as const).map(async (key) => {
      const media = report[key];
      if (Array.isArray(media?.video) && media.video.length)
        return media as Json;
      const path = paths[key];
      if (!path) return {};
      try {
        return await request("probe", { path });
      } catch {
        notices.push(
          `${key === "source" ? "原始视频" : "处理成片"}无法读取，相关参数显示为未测量。`,
        );
        return {};
      }
    }),
  );
  return { source: results[0], output: results[1], report, notices };
}

export type ComparisonRow = {
  key: string;
  label: string;
  before: string;
  after: string;
  change: "已变化" | "一致" | "未测量";
};
const numeric = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const number = (value: unknown, unit: string, divisor = 1, digits = 2) => {
  const measured = numeric(value);
  return measured === undefined
    ? "未测量"
    : `${(measured / divisor).toFixed(digits)} ${unit}`.trim();
};
const text = (value: unknown) =>
  typeof value === "string" && value.length ? value.toUpperCase() : "未测量";

/** Match the original desktop's before/after measurements without inferring quality. */
export function comparisonRows(data: ComparisonData): ComparisonRow[] {
  const metadata = (media: Json, source: boolean) => {
    const video = media.video?.[0] || {};
    const audio = media.audio?.[0] || {};
    const noAudio = Array.isArray(media.audio) && media.audio.length === 0;
    const loudness = source
      ? data.report.audio_normalization?.measurement?.input_i
      : (data.report.quality_check?.loudness?.streams?.[0]?.integrated_lufs ??
        data.report.loudness?.streams?.[0]?.integrated_lufs);
    const resolution =
      numeric(video.width) && numeric(video.height)
        ? `${video.width} × ${video.height}`
        : undefined;
    const fields: [string, string, unknown, string][] = [
      ["resolution", "分辨率", resolution, resolution || "未测量"],
      ["fps", "帧率", numeric(video.fps), number(video.fps, "fps", 1, 3)],
      [
        "duration",
        "时长",
        numeric(media.duration_sec),
        number(media.duration_sec, "秒", 1, 3),
      ],
      ["codec", "视频编码", video.codec, text(video.codec)],
      [
        "bitrate",
        "视频码率",
        numeric(video.bit_rate),
        number(video.bit_rate, "Mbps", 1_000_000),
      ],
      [
        "size",
        "文件大小",
        numeric(media.size_bytes),
        number(media.size_bytes, "MB", 1_000_000),
      ],
      ["container", "封装格式", media.container, text(media.container)],
      ["pixels", "像素格式", video.pix_fmt, text(video.pix_fmt)],
      ["loudness", "综合响度", numeric(loudness), number(loudness, "LUFS")],
      ["audioCodec", "音频编码", audio.codec, text(audio.codec)],
      [
        "sampleRate",
        "音频采样率",
        numeric(audio.sample_rate),
        number(audio.sample_rate, "kHz", 1000, 1),
      ],
      [
        "audioBitrate",
        "音频码率",
        numeric(audio.bit_rate),
        number(audio.bit_rate, "kbps", 1000, 1),
      ],
      [
        "channels",
        "声道数",
        numeric(audio.channels),
        number(audio.channels, "", 1, 0),
      ],
    ];
    return fields.map(([key, label, raw, display], index) => ({
      key,
      label,
      raw: noAudio && index >= 8 ? "无音轨" : raw,
      display: noAudio && index >= 8 ? "无音轨" : display,
    }));
  };
  const before = metadata(data.source, true);
  const after = metadata(data.output, false);
  return before.map((item, index) => ({
    key: item.key,
    label: item.label,
    before: item.display,
    after: after[index].display,
    change:
      item.raw == null || after[index].raw == null
        ? "未测量"
        : item.raw === after[index].raw
          ? "一致"
          : "已变化",
  }));
}
