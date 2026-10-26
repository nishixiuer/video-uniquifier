import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { navigate } from "./navigation";

let app: ElectronApplication;
let page: Page;
let folder: string;
let clip: string;
let output: string;
const env = () => {
  const value = {
    ...process.env,
    VIDEO_UNIQ_DESKTOP_DATA: join(folder, "data"),
  };
  delete value.ELECTRON_RUN_AS_NODE;
  return value;
};
async function launch() {
  app = await electron.launch(
    process.env.VIDEO_UNIQ_TEST_PACKAGED
      ? {
          executablePath: resolve(
            "release/mac-arm64/Video Uniquifier.app/Contents/MacOS/Video Uniquifier",
          ),
          args: [],
          env: { ...env(), PATH: "/usr/bin:/bin" },
        }
      : { args: [resolve("dist-electron/main.cjs")], env: env() },
  );
  page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
}
test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "video-uniq-electron-"));
  clip = join(folder, "测试素材.mp4");
  output = join(folder, "exports");
  mkdirSync(output);
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=128x224:rate=30:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clip,
  ]);
  if (result.status !== 0) throw new Error(String(result.stderr));
  await launch();
});
test.afterAll(async () => {
  await app?.close();
  rmSync(folder, { recursive: true, force: true });
});

test("中文导航和独立页面可操作", async () => {
  await navigate(page, "视频处理");
  await expect(
    page.getByText("短剧交付 · 默认", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "批量处理",
    "短剧制作",
    "自动调参",
    "质量报告",
    "处理配置",
    "历史记录",
    "参考素材库",
    "处理队列",
    "实验版本",
    "服务配置",
    "设置",
  ]) {
    await navigate(page, name);
  }
  await navigate(page, "视频处理");
  await page.screenshot({
    path: "screenshots/processing-zh.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("导航分组、侧栏收窄和固定设置入口支持键盘及状态恢复", async () => {
  const workspace = page.getByRole("button", { name: "视频工具", exact: true });
  await workspace.click();
  await expect(workspace).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("link", { name: "批量处理", exact: true }),
  ).not.toBeVisible();
  await workspace.press("Space");
  await expect(workspace).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "侧栏" })).toHaveClass(
    /is-collapsed/,
  );
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
    )
    .toBe(76);
  await navigate(page, "自动调参");
  await page.screenshot({
    path: "screenshots/navigation-icons-zh.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "展开侧栏", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "调优与质量", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "工具", exact: true }).click();
  const closed = await page
    .getByRole("button", { name: "工具", exact: true })
    .getAttribute("aria-expanded");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "工具", exact: true }),
  ).toHaveAttribute("aria-expanded", closed!);
  await navigate(page, "服务配置");
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(
    page
      .getByRole("navigation", { name: "配置与偏好" })
      .getByRole("link", { name: "设置", exact: true }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page
        .getByRole("navigation", { name: "主导航" })
        .evaluate((element) => getComputedStyle(element).scrollbarWidth),
    )
    .toBe("thin");
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) => ({
        width: getComputedStyle(element).scrollbarWidth,
        scheme: getComputedStyle(element).colorScheme,
      })),
    )
    .toEqual({ width: "thin", scheme: "dark" });
  await page.screenshot({
    path: "screenshots/navigation-compact-zh.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 928 });
  await navigate(page, "视频处理");
});

test("文件预览、真实处理、对比、报告与重启恢复", async () => {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, clip);
  await page.getByRole("button", { name: "选择", exact: true }).first().click();
  await expect(page.getByText("测试素材.mp4", { exact: true })).toBeVisible();
  const video = page.locator("video");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, output);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: "完整导出" }).click();
  await expect(page.getByText("成片已完成", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "视频对比", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.locator("video")).toHaveCount(2);
  await expect(
    modal.getByRole("button", { name: "同步播放", exact: true }),
  ).toBeEnabled();
  await modal.getByRole("button", { name: "同步播放", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      modal
        .locator("video")
        .nth(1)
        .evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await modal.getByRole("tab", { name: "参数对比", exact: true }).click();
  await expect(
    modal.getByRole("cell", { name: "128 × 224", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("cell", { name: "1080 × 1920", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("cell", { name: "已变化", exact: true }).first(),
  ).toBeVisible();
  await modal.getByRole("tab", { name: "画面对比", exact: true }).click();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "质量报告", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", { name: "128 × 224", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: "检查明细", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("检查项目", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭报告", exact: true }).click();
  await app.close();
  await launch();
  await navigate(page, "历史记录");
  await expect(page.getByText("测试素材.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "视频对比", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "同步播放", exact: true }),
  ).toBeEnabled();
  for (const video of await page.getByRole("dialog").locator("video").all()) {
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
  }
  await page.screenshot({
    path: "screenshots/comparison-zh.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "质量报告", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", { name: "128 × 224", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "screenshots/parameters-zh.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: "检查明细", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("检查项目", { exact: true }),
  ).toBeVisible();
});
