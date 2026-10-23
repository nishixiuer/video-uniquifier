import { describe, expect, it } from "vitest";
import { reportRows } from "./report";
import {
  fileName,
  kindLabel,
  stageLabel,
  statusLabel,
  terminal,
  type Job,
} from "./types";

describe("readable quality reports", () => {
  it("keeps zero, false and missing metrics distinct", () => {
    const rows = reportRows({
      elapsed_sec: 0,
      quality_check: { decode_ok: false },
      vmaf_mean: null,
    });
    expect(rows.map((row) => row.value)).toEqual(["0", "否", "未测量"]);
    expect(rows[0].label).toBe("处理耗时（秒）");
  });
  it("presents nested checks as rows instead of JSON", () => {
    const rows = reportRows({
      quality_check: { failures: [] },
      warnings: ["Video upscaled"],
      source: { video: [{ width: 720, height: 1280 }] },
    });
    expect(rows.some((row) => row.value === "全部通过")).toBe(true);
    expect(
      rows.some((row) => row.label === "宽度（像素）" && row.value === "720"),
    ).toBe(true);
    expect(rows.every((row) => !row.value.startsWith("{"))).toBe(true);
  });
  it("omits command arguments and bulky internal samples", () => {
    expect(
      reportRows({
        execution_argv: ["ffmpeg"],
        phash_frames: [1, 2],
        status: "success",
      }),
    ).toHaveLength(1);
  });
});
describe("desktop labels", () => {
  it("normalizes Windows and macOS paths", () => {
    expect(fileName("C:\\视频\\片段.mp4")).toBe("片段.mp4");
    expect(fileName("/videos/test.mp4")).toBe("test.mp4");
  });
  it("translates live task states", () => {
    expect(statusLabel("queued")).toBe("等待处理");
    expect(stageLabel("quality:vmaf")).toBe("生成质量报告");
    expect(kindLabel("reels")).toBe("短剧交付");
    expect(terminal({ status: "paused" } as Job)).toBe(false);
    expect(terminal({ status: "success" } as Job)).toBe(true);
  });
});
