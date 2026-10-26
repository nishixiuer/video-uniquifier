import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { navigate } from "./navigation";
import { CALLBACK_MAPPING } from "../src/shared/callback-mapping";
import type { PublishingSnapshot } from "../src/shared/publishing";

test("服务配置可开关本机回调映射并恢复原回调，自动化测试不修改系统代理", async () => {
  const folder = mkdtempSync(join(tmpdir(), "callback-mapping-ui-"));
  const env = { ...process.env, VIDEO_UNIQ_DESKTOP_DATA: folder };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.VIDEO_UNIQ_TEST_PACKAGED
      ? {
          executablePath: resolve(
            "release/mac-arm64/Video Uniquifier.app/Contents/MacOS/Video Uniquifier",
          ),
          env: { ...env, PATH: "/usr/bin:/bin" },
        }
      : { args: [resolve("dist-electron/main.cjs")], env },
  );
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "素材库", exact: true }),
    ).toBeVisible();
    const snapshot = await page.evaluate(() =>
      window.electronAPI.publishing<PublishingSnapshot>("snapshot"),
    );
    // The real Yerd adapter is covered separately. This UI test must never touch the user's proxy rules.
    await app.evaluate(
      ({ ipcMain }, { snapshot, redirectUri }) => {
        ipcMain.removeHandler("publishing:call");
        ipcMain.handle("publishing:call", (_event, method, params) => {
          if (method === "app.mapping") {
            if (params.enabled) {
              snapshot.app.localCallback = {
                previousRedirectUri: snapshot.app.redirectUri,
              };
              snapshot.app.redirectUri = redirectUri;
            } else {
              snapshot.app.redirectUri =
                snapshot.app.localCallback!.previousRedirectUri;
              delete snapshot.app.localCallback;
            }
          } else if (method !== "snapshot")
            throw new Error("Unexpected test call");
          return snapshot;
        });
      },
      { snapshot, redirectUri: CALLBACK_MAPPING.redirectUri },
    );
    await navigate(page, "服务配置");
    const toggle = page.getByRole("switch", {
      name: "本机域名映射",
      exact: true,
    });
    const callback = page.getByLabel("OAuth 回调地址", { exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(callback).toHaveValue(CALLBACK_MAPPING.redirectUri);
    await expect(callback).toHaveAttribute("readonly", "");
    await expect(
      page.getByText(
        "请将上面的完整 HTTPS 地址加入 Meta 的有效 OAuth 跳转 URI，然后重新发起授权。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator(".ant-message-notice")).toHaveCount(0);
    await page.screenshot({
      path: "screenshots/callback-mapping-zh.png",
      fullPage: true,
      animations: "disabled",
    });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(callback).toHaveValue(snapshot.app.redirectUri);
    await expect(callback).not.toHaveAttribute("readonly", "");
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
