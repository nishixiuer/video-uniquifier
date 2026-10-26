import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { navigate } from "./navigation";

let app: ElectronApplication;
let page: Page;
let folder: string;
let server: Server;
let endpoint: string;
let aiCalls = 0;
const key = "TEST_AI_KEY_NOT_FOR_REAL_API";
const errors: string[] = [];
test.describe.configure({ mode: "serial" });
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
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "视频处理", exact: true }),
  ).toBeVisible();
}
async function go(name: string) {
  await navigate(page, name);
}
async function capture(name: string) {
  await expect(page.locator(".ant-message-notice")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `screenshots/${name}-zh.png`,
    fullPage: true,
    animations: "disabled",
  });
}
test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "video-uniq-publishing-e2e-"));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (
        req.url !== "/v1/chat/completions" ||
        req.headers.authorization !== `Bearer ${key}`
      ) {
        res.writeHead(400).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (body.model !== "local-test" || body.messages.length !== 2) {
        res.writeHead(422).end();
        return;
      }
      aiCalls++;
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `本机模拟生成文案 ${aiCalls}：短剧精彩片段 #短剧`,
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

test("独立中文导航、手动草稿、图片预览和审核", async () => {
  for (const name of ["帖子内容", "主页授权", "发布任务"]) await go(name);
  await go("帖子内容");
  await page.getByRole("button", { name: /新建帖子/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("帖子标题", { exact: true }).fill("本地图片帖子");
  await dialog
    .getByLabel("文案正文", { exact: true })
    .fill("这是本地审核测试，不会实际发布。");
  const image = join(folder, "封面.png");
  writeFileSync(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, image);
  await dialog
    .getByRole("button", { name: "添加本地图片 / 视频", exact: true })
    .click();
  await expect(
    dialog.getByText("图片 · 封面.png", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("img")).toHaveAttribute(
    "src",
    /^media:\/\/local\//,
  );
  await dialog.getByRole("button", { name: "保存帖子", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "本地图片帖子" });
  await expect(row.getByText("待审核", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "安排发布" })).toBeDisabled();
  await row.getByRole("button", { name: "审核通过" }).click();
  await expect(row.getByText("已审核", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("这是本地审核测试，不会实际发布。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await capture("publishing-posts");
});

test("可配置 AI 接口通过主进程生成并保存待审核内容", async () => {
  await go("帖子内容");
  await page.getByRole("tab", { name: "批量生成", exact: true }).click();
  await page.getByLabel("产品 / 短剧名称", { exact: true }).fill("短剧测试");
  await page
    .getByLabel("产品资料 / 剧情介绍", { exact: true })
    .fill("仅本机模拟服务测试，禁止真实发帖。");
  await page.getByRole("link", { name: "管理 AI 接口 →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "服务配置", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Base URL", { exact: false }).fill(endpoint);
  await page.getByLabel("模型名称", { exact: true }).fill("local-test");
  await page.getByLabel("API Key", { exact: false }).fill(key);
  await page.getByRole("button", { name: "保存 AI 接口", exact: true }).click();
  await expect(
    page.getByLabel("API Key（已加密保存，留空保留）", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("link", { name: "前往帖子内容 →", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "批量生成", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("产品 / 短剧名称", { exact: true })).toHaveValue(
    "短剧测试",
  );
  await expect(
    page.getByLabel("产品资料 / 剧情介绍", { exact: true }),
  ).toHaveValue("仅本机模拟服务测试，禁止真实发帖。");
  await page.getByLabel("生成数量", { exact: true }).fill("2");
  await page.getByLabel("生成方式", { exact: true }).press("ArrowDown");
  await page.getByLabel("生成方式", { exact: true }).press("ArrowDown");
  await page.getByLabel("生成方式", { exact: true }).press("Enter");
  await expect(
    page.locator(".ant-select-selection-item").filter({ hasText: "AI 文案" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "生成待审核帖子", exact: true })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "已生成，等待审核" }),
  ).toHaveCount(2);
  expect(aiCalls).toBe(2);
  const snapshot = await page.evaluate(() =>
    window.electronAPI.publishing("snapshot"),
  );
  expect(JSON.stringify(snapshot)).not.toContain(key);
  expect(
    readFileSync(join(folder, "data/publishing/credentials.enc.json"), "utf8"),
  ).not.toContain(key);
  await capture("publishing-generate");
});

test("Meta 应用本机加密配置和任务暂停状态可在重启后恢复", async () => {
  await go("服务配置");
  await page.getByLabel("Meta App ID", { exact: true }).fill("123456789");
  await page.getByLabel("App Secret", { exact: true }).fill("TEST_META_SECRET");
  await page.getByRole("button", { name: "保存应用配置", exact: true }).click();
  await expect(
    page.getByLabel("App Secret（已加密保存，留空保留）", { exact: true }),
  ).toHaveValue("");
  await capture("publishing-settings");
  await page.getByRole("link", { name: "前往主页授权 →", exact: true }).click();
  await expect(page.getByLabel("Meta App ID", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开 Facebook 官方授权", exact: true }),
  ).toBeEnabled();
  expect(
    readFileSync(join(folder, "data/publishing/credentials.enc.json"), "utf8"),
  ).not.toContain("TEST_META_SECRET");
  await capture("publishing-pages");
  await go("发布任务");
  await page.getByRole("button", { name: "暂停发布调度", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复发布调度", exact: true }),
  ).toBeVisible();
  await app.close();
  await launch();
  await go("发布任务");
  await expect(
    page.getByRole("button", { name: "恢复发布调度", exact: true }),
  ).toBeVisible();
  await capture("publishing-tasks");
  await go("帖子内容");
  await page.getByRole("tab", { name: /内容库/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "本地图片帖子" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "本机模拟生成文案" }),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});
