import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  safeStorage,
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { promises as fs } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { PublishingService } from "./publishing/service";
import { YerdCallbackMapping } from "./publishing/callback-mapping";

const repoRoot = resolve(__dirname, "../..");
const grants = new Set<string>();
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
let child: ChildProcessWithoutNullStreams | undefined;
let window: BrowserWindow | null = null;
let quitting = false;
let stopped = false;
let engineError = "";
let lastLogs = "";
let publishing: PublishingService;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
app.setName("Video Uniquifier Electron");
if (process.env.VIDEO_UNIQ_DESKTOP_DATA)
  app.setPath("userData", resolve(process.env.VIDEO_UNIQ_DESKTOP_DATA));

function grant(path: string): string {
  const actual = realpathSync(path);
  grants.add(actual);
  return actual;
}
function allowed(path: string): string {
  const actual = realpathSync(path);
  if (
    ![...grants].some((root) => {
      const rel = relative(root, actual);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    })
  )
    throw new Error("请先通过文件选择器选择这个文件或目录。");
  return actual;
}
function track(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const job = value as Record<string, unknown>;
  for (const field of ["source", "output", "report"]) {
    const path = job[field];
    if (typeof path === "string" && existsSync(path)) grant(path);
  }
  if (Array.isArray(value)) value.forEach(track);
  if (Array.isArray(job.jobs)) job.jobs.forEach(track);
  const result = job.result as { variants?: unknown[] } | null;
  result?.variants?.forEach(track);
}
function rpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (engineError) return Promise.reject(new Error(engineError));
  return new Promise((resolveCall, reject) => {
    if (!child || child.exitCode !== null)
      return reject(new Error("Python 处理引擎未运行。"));
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("本地引擎响应超时。"));
    }, 60_000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
async function startEngine(): Promise<void> {
  const executable =
    process.platform === "win32"
      ? "video-uniquifier-python.exe"
      : "video-uniquifier-python";
  const runtime = app.isPackaged
    ? join(
        process.resourcesPath,
        "python",
        "video-uniquifier-python",
        executable,
      )
    : (process.env.VIDEO_UNIQ_PYTHON ??
      join(
        repoRoot,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      ));
  if (!existsSync(runtime)) throw new Error(`找不到 Python 运行时：${runtime}`);
  const root = join(app.getPath("userData"), "engine");
  await fs.mkdir(root, { recursive: true });
  grant(root);
  const args = app.isPackaged
    ? ["--root", root]
    : [join(repoRoot, "desktop-electron/python/bridge.py"), "--root", root];
  child = spawn(runtime, args, {
    cwd: app.isPackaged ? app.getPath("userData") : repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: app.isPackaged ? undefined : join(repoRoot, "src"),
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (data: Buffer) => {
    lastLogs = (lastLogs + data.toString()).slice(-4000);
    console.error(data.toString().trim());
  });
  await new Promise<void>((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Python 启动超时。${lastLogs}`)),
      45_000,
    );
    createInterface({ input: child!.stdout }).on("line", (line) => {
      try {
        const payload = JSON.parse(line);
        if (payload.event === "ready") {
          clearTimeout(timeout);
          resolveReady();
        } else if (payload.event === "job") {
          track(payload.data);
          window?.webContents.send("engine:job", payload.data);
        } else {
          const request = pending.get(payload.id);
          if (request) {
            clearTimeout(request.timer);
            pending.delete(payload.id);
            if (payload.error) request.reject(new Error(payload.error));
            else {
              track(payload.result);
              request.resolve(payload.result);
            }
          }
        }
      } catch (error) {
        console.error("Invalid engine message", error);
      }
    });
    child!.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child!.on("exit", (code) => {
      stopped = true;
      const error = new Error(`Python 引擎已退出（${code}）。${lastLogs}`);
      clearTimeout(timeout);
      reject(error);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
      if (!quitting) {
        engineError = error.message;
        window?.webContents.send("engine:error", engineError);
      }
    });
  });
}

function registerIpc(): void {
  ipcMain.handle(
    "publishing:call",
    async (_event, method: string, params: Record<string, unknown> = {}) => {
      const result = await publishing.dispatch(method, params);
      const snapshot = publishing.snapshot();
      snapshot.posts.forEach((post) =>
        post.media.forEach((media) => {
          if (existsSync(media.path)) grant(media.path);
        }),
      );
      snapshot.materials.forEach((material) => {
        if (existsSync(material.video.path)) grant(material.video.path);
      });
      if (method === "media.import" && Array.isArray(result))
        result.forEach((media) => grant(media.path));
      return result;
    },
  );
  ipcMain.handle("publishing:open", (_event, taskId: string) => {
    const task = publishing.snapshot().tasks.find((task) => task.id === taskId);
    if (!task?.url) throw new Error("该任务还没有远端链接。");
    const url = new URL(task.url);
    if (url.protocol !== "https:" || url.hostname !== "www.facebook.com")
      throw new Error("无效的帖子链接。");
    return shell.openExternal(url.toString());
  });
  const methods = new Set([
    "bootstrap",
    "jobs.list",
    "jobs.submit",
    "jobs.action",
    "report.read",
    "profiles.list",
    "profiles.save",
    "rules.save",
    "config.validate",
    "corpus.list",
    "corpus.remove",
    "probe",
    "queue.init",
    "queue.add",
    "queue.status",
    "queue.recover",
    "history.import",
  ]);
  ipcMain.handle(
    "engine:call",
    async (_event, method: string, params: Record<string, unknown> = {}) => {
      if (!methods.has(method)) throw new Error("不支持的桌面调用。");
      if (method === "jobs.submit") {
        for (const field of ["source", "comparison", "output_dir"])
          if (params[field]) allowed(String(params[field]));
        if (params.assets)
          Object.values(params.assets as Record<string, string>).forEach(
            allowed,
          );
      }
      if (method === "probe") allowed(String(params.path));
      if (method === "history.import") allowed(String(params.path));
      if (method.startsWith("queue.")) {
        allowed(String(params.root));
        if (params.files) (params.files as string[]).forEach(allowed);
      }
      return rpc(method, params);
    },
  );
  ipcMain.handle(
    "dialog:pick",
    async (_event, kind: string, multiple: boolean = false) => {
      const extensions =
        kind === "post-media"
          ? ["jpg", "jpeg", "png", "mp4", "mov"]
          : kind === "history"
            ? ["json"]
            : kind === "font"
              ? ["ttf", "otf", "ttc"]
              : kind === "image"
                ? ["png", "jpg", "jpeg", "webp"]
                : kind === "config"
                  ? ["yaml", "yml"]
                  : ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
      const result = await dialog.showOpenDialog(window!, {
        properties:
          kind === "directory"
            ? ["openDirectory", "createDirectory"]
            : multiple
              ? ["openFile", "multiSelections"]
              : ["openFile"],
        filters:
          kind === "directory" ? [] : [{ name: "支持的文件", extensions }],
      });
      return result.canceled ? [] : result.filePaths.map(grant);
    },
  );
  ipcMain.handle(
    "files:list",
    async (_event, directory: string, recursive: boolean) => {
      const root = allowed(directory);
      const output: string[] = [];
      const walk = async (path: string) => {
        for (const entry of await fs.readdir(path, { withFileTypes: true })) {
          const target = join(path, entry.name);
          if (entry.isDirectory() && recursive) await walk(target);
          else if (
            entry.isFile() &&
            [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(
              extname(entry.name).toLowerCase(),
            )
          )
            output.push(grant(target));
        }
      };
      await walk(root);
      return output.sort();
    },
  );
  ipcMain.handle("files:read-text", (_event, path: string) =>
    fs.readFile(allowed(path), "utf8"),
  );
  ipcMain.handle("files:reveal", (_event, path: string) =>
    shell.showItemInFolder(allowed(path)),
  );
  ipcMain.handle(
    "files:media-url",
    (_event, path: string) =>
      `media://local/${encodeURIComponent(allowed(path))}`,
  );
  ipcMain.handle("settings:read", async () => {
    const path = join(app.getPath("userData"), "settings.json");
    return existsSync(path)
      ? JSON.parse(await fs.readFile(path, "utf8"))
      : {
          language: "zh_CN",
          theme: "dark",
          method: "reels",
          reducedMotion: false,
        };
  });
  ipcMain.handle("settings:save", async (_event, settings: unknown) => {
    const file = join(app.getPath("userData"), "settings.json");
    await fs.writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2));
    await fs.rename(`${file}.tmp`, file);
  });
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    title: "Video Uniquifier",
    backgroundColor: "#101418",
    webPreferences: {
      preload: join(__dirname, "../dist-preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(__dirname, "../dist/index.html"));
  window.on("closed", () => {
    window = null;
  });
}
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  publishing = new PublishingService({
    root: join(app.getPath("userData"), "publishing"),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    secure: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    allowed,
    callbackMapping:
      process.platform === "darwin" ? new YerdCallbackMapping() : undefined,
    engine: async <T>(method: string, params: Record<string, unknown> = {}) => {
      if (method === "probe" && typeof params.path === "string")
        grant(params.path);
      const result = await rpc(method, params);
      return result as T;
    },
    open: (url) => shell.openExternal(url),
  });
  publishing.start();
  protocol.handle("media", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local")
        return new Response("Forbidden", { status: 403 });
      const path = allowed(decodeURIComponent(url.pathname.slice(1)));
      return net.fetch(pathToFileURL(path).toString(), {
        headers: request.headers,
      });
    } catch {
      return new Response("Media unavailable", { status: 404 });
    }
  });
  registerIpc();
  try {
    await startEngine();
    publishing.production.start();
  } catch (error) {
    engineError = String(error);
  }
  await createWindow();
  app.on("activate", () => {
    if (!window) void createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  publishing?.close();
  if (stopped || !child || quitting) return;
  event.preventDefault();
  quitting = true;
  // EOF lets the engine cancel work and reap its ffmpeg children before exiting.
  child.stdin.end();
  const timeout = setTimeout(() => {
    child?.kill("SIGTERM");
    app.exit();
  }, 20_000);
  child.once("exit", () => {
    clearTimeout(timeout);
    app.quit();
  });
});
