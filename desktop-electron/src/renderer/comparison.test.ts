import { expect, it, vi } from "vitest";
import { comparisonRows, loadComparison } from "./comparison";
import type { Job } from "./types";

const media = {
  video: [
    { width: 720, height: 1280, fps: 30, codec: "h264", bit_rate: 1_000_000 },
  ],
  audio: [{ codec: "aac", channels: 2, sample_rate: 48000, bit_rate: 128_000 }],
  duration_sec: 10,
  size_bytes: 2_000_000,
};
const job = {
  id: "a",
  source: "in.mp4",
  output: "out.mp4",
  report: "report.json",
} as Job;

it("shows measured values side by side and detects raw changes before rounding", () => {
  const rows = comparisonRows({
    source: media,
    output: {
      ...media,
      size_bytes: 2_000_001,
      video: [{ ...media.video[0], width: 1080 }],
    },
    report: {
      audio_normalization: { measurement: { input_i: 0 } },
      quality_check: { loudness: { streams: [{ integrated_lufs: -14 }] } },
    },
    notices: [],
  });
  expect(rows.find((row) => row.key === "resolution")).toMatchObject({
    before: "720 × 1280",
    after: "1080 × 1280",
    change: "已变化",
  });
  expect(rows.find((row) => row.key === "size")?.change).toBe("已变化");
  expect(rows.find((row) => row.key === "fps")?.change).toBe("一致");
  expect(rows.find((row) => row.key === "loudness")?.before).toBe("0.00 LUFS");
  expect(rows.find((row) => row.key === "sampleRate")?.before).toBe("48.0 kHz");
});

it("keeps missing, zero and no audio distinct without marking unknown values equal", () => {
  const rows = comparisonRows({
    source: { ...media, audio: [] },
    output: { ...media, video: [{ bit_rate: 0 }] },
    report: {},
    notices: [],
  });
  expect(rows.find((row) => row.key === "loudness")).toMatchObject({
    before: "无音轨",
    after: "未测量",
    change: "未测量",
  });
  expect(rows.find((row) => row.key === "audioCodec")?.change).toBe("已变化");
  expect(rows.find((row) => row.key === "bitrate")?.after).toBe("0.00 Mbps");
  expect(
    comparisonRows({ source: {}, output: {}, report: {}, notices: [] }).every(
      (row) => row.change === "未测量",
    ),
  ).toBe(true);
});

it("uses saved delivery measurements even when files have moved", async () => {
  const request = vi.fn().mockResolvedValue({ source: media, output: media });
  const data = await loadComparison(job, request);
  expect(request).toHaveBeenCalledExactlyOnceWith("report.read", { id: "a" });
  expect(data.source).toEqual(media);
  expect(data.notices).toEqual([]);
});

it("probes native and legacy videos and tolerates either file missing", async () => {
  const request = vi.fn(async (method: string, params: object) => {
    if (
      method === "report.read" ||
      (params as { path: string }).path === "in.mp4"
    )
      throw new Error("missing");
    return media;
  });
  const data = await loadComparison(job, request);
  expect(request).toHaveBeenCalledTimes(3);
  expect(data.source).toEqual({});
  expect(data.output).toEqual(media);
  expect(data.notices).toHaveLength(2);
  const withSaved = vi.fn().mockResolvedValue(media);
  await loadComparison(job, withSaved, { source: media });
  expect(withSaved).toHaveBeenCalledExactlyOnceWith("probe", {
    path: "out.mp4",
  });
});
