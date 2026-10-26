import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { navigate } from "./navigation";
import type { PublishingSnapshot } from "../src/shared/publishing";

let app: ElectronApplication;
let page: Page;
let folder: string;
let server: Server;
let endpoint: string;
const prompts: string[] = [];
async function launch() {
  const env = { ...process.env, VIDEO_UNIQ_DESKTOP_DATA: join(folder, "data") };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch(
    process.env.VIDEO_UNIQ_TEST_PACKAGED
      ? {
          executablePath: resolve(
            "release/mac-arm64/Video Uniquifier.app/Contents/MacOS/Video Uniquifier",
          ),
          env: { ...env, PATH: "/usr/bin:/bin" },
        }
      : { args: [resolve("dist-electron/main.cjs")], env },
  );
  page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
}
test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "video-production-e2e-"));
  const clip = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=128x224:rate=30:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(folder, "都市短剧.mp4"),
  ]);
  if (clip.status !== 0) throw new Error(String(clip.stderr));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (
        req.url !== "/v1/chat/completions" ||
        req.headers.authorization !== "Bearer TEST_ONLY"
      )
        return void res.writeHead(400).end();
      const body = JSON.parse(Buffer.concat(chunks).toString());
      prompts.push(body.messages[1].content);
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `都市短剧推广 ${prompts.length}：人物关系与精彩片段 #情感`,
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  await launch();
});
test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

test("素材资料 → 真实批量剪片 + AI 文案 → 内容库审核、对比与重启追溯", async () => {
  test.setTimeout(150_000);
  await navigate(page, "服务配置");
  await page.getByLabel("Base URL", { exact: false }).fill(endpoint);
  await page.getByLabel("模型名称", { exact: true }).fill("local-test");
  await page.getByLabel("API Key", { exact: false }).fill("TEST_ONLY");
  await page.getByRole("button", { name: "保存 AI 接口", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: false })).toHaveValue("");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await page.getByLabel("模板名称", { exact: true }).fill("短剧推广提示词");
  await page
    .getByLabel("模板正文", { exact: true })
    .fill(
      "根据 {title} 与 {description} 生成 {language} 推广文案，保留真实信息。",
    );
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await navigate(page, "素材库");
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    },
    join(folder, "都市短剧.mp4"),
  );
  await page.getByRole("button", { name: "导入视频", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "视频资料", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("剧情介绍 / 推广资料", { exact: true })
    .fill("都市短剧，围绕人物关系反转展开。只宣传已提供的资料，不编造剧情。");
  await page
    .getByLabel("分类（自动加入内容标签）", { exact: true })
    .fill("情感");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("可制作", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "screenshots/materials-zh.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "制作帖子", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "批量制作", exact: true }),
  ).toBeVisible();
  await page.getByLabel("批次名称", { exact: true }).fill("短剧推广第一批");
  await page.getByLabel("每段时长（秒）", { exact: true }).fill("1");
  await page.getByLabel("每个视频制作条数", { exact: true }).fill("2");
  await page
    .locator(".ant-select")
    .filter({ has: page.getByLabel("推广文案提示词", { exact: true }) })
    .click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("短剧推广提示词", { exact: true })
    .click();
  await page.getByLabel("镜头分析", { exact: true }).click();
  await page.getByRole("button", { name: "预览剪片计划", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("cell", { name: "0–1 秒", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("cell", { name: "1–2 秒", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回制作设置", exact: true }).click();
  await page.getByRole("button", { name: "开始批量制作", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("短剧推广第一批", { exact: false })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "前往内容库审核 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "内容库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "都市短剧推广" }),
  ).toHaveCount(2, { timeout: 100_000 });
  const snapshot = await page.evaluate(() =>
    window.electronAPI.publishing<PublishingSnapshot>("snapshot"),
  );
  expect(
    snapshot.batches[0].items.every((item) => item.status === "succeeded"),
  ).toBe(true);
  expect(
    snapshot.posts.every(
      (post) => post.source?.batchId === snapshot.batches[0].id,
    ),
  ).toBe(true);
  expect(prompts).toHaveLength(2);
  expect(snapshot.batches[0].template.name).toBe("短剧推广提示词");
  expect(prompts[0]).toContain("0–1 秒");
  expect(prompts[1]).toContain("1–2 秒");
  const outputs = await page.evaluate(
    async (posts) =>
      Promise.all(
        posts.map((post) =>
          window.electronAPI.call<{ duration_sec: number }>("probe", {
            path: post.media[0].path,
          }),
        ),
      ),
    snapshot.posts,
  );
  for (const output of outputs) expect(output.duration_sec).toBeCloseTo(1, 1);
  const row = page.getByRole("row").filter({ hasText: "都市短剧 · 0–1 秒" });
  await row.getByRole("button", { name: "预览", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await row.getByRole("button", { name: "视频对比", exact: true }).click();
  await expect(page.getByRole("dialog").locator("video")).toHaveCount(2);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await row.getByRole("button", { name: "质量报告", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("cell", { name: "720 × 1280", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭报告", exact: true }).click();
  await row.getByRole("button", { name: "审核通过", exact: true }).click();
  await expect(row.getByText("已审核", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "screenshots/production-content-zh.png",
    fullPage: true,
    animations: "disabled",
  });
  await navigate(page, "批量制作");
  await page.screenshot({
    path: "screenshots/production-zh.png",
    fullPage: true,
    animations: "disabled",
  });
  await app.close();
  await launch();
  await navigate(page, "内容库");
  await expect(
    page.getByRole("row").filter({ hasText: "都市短剧推广" }),
  ).toHaveCount(2);
  const restored = await page.evaluate(() =>
    window.electronAPI.publishing<PublishingSnapshot>("snapshot"),
  );
  expect(restored.materials).toHaveLength(1);
  expect(restored.batches).toHaveLength(1);
  expect(restored.posts).toHaveLength(2);
  await navigate(page, "素材库");
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await navigate(page, "内容库");
  await expect(page.getByText("来源已停用", { exact: true })).toHaveCount(2);
});
