import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const projectPython = resolve(
  "..",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python = process.env.VIDEO_UNIQ_PYTHON || projectPython;
if (!existsSync(python)) throw new Error(`未找到项目 Python 环境：${python}`);
const result = spawnSync(
  python,
  ["python/build_runtime.py", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
