import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CALLBACK_MAPPING,
  type CallbackMappingAdapter,
} from "../shared/callback-mapping";

type Runner = (args: string[]) => Promise<string>;
const execute = promisify(execFile);

/** Change only the dedicated callback path; never replace the existing PHP site. */
export class YerdCallbackMapping implements CallbackMappingAdapter {
  constructor(
    private run: Runner = async (args) => {
      try {
        const result = await execute(
          "/Applications/Yerd.app/Contents/MacOS/yerd",
          ["--json", ...args],
          {
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
          },
        );
        return result.stdout;
      } catch {
        throw new Error(
          "无法配置本机映射，请确认已安装并启动 Yerd，且 media-share.test 站点可访问。",
        );
      }
    },
  ) {}

  async set(enabled: boolean) {
    const data = JSON.parse(await this.run(["proxy", "list"])) as {
      proxies: { name: string }[];
      rules: { site: string; prefix: string; target: string }[];
    };
    if (!Array.isArray(data.proxies) || !Array.isArray(data.rules))
      throw new Error("Yerd 返回的代理配置格式无效，请更新 Yerd 后重试。");
    if (data.proxies.some((proxy) => proxy.name === CALLBACK_MAPPING.site))
      throw new Error(
        "media-share.test 已有整站代理，请先在 Yerd 中检查，避免覆盖现有配置。",
      );
    const rule = data.rules.find(
      (entry) =>
        entry.site === CALLBACK_MAPPING.site &&
        entry.prefix === CALLBACK_MAPPING.prefix,
    );
    if (rule && rule.target !== CALLBACK_MAPPING.upstream)
      throw new Error(
        "该回调路径已有其他代理，未修改现有配置。请先在 Yerd 中检查。",
      );
    if (enabled && !rule)
      await this.run([
        "proxy",
        "add",
        CALLBACK_MAPPING.site,
        CALLBACK_MAPPING.prefix,
        CALLBACK_MAPPING.upstream,
      ]);
    else if (!enabled && rule)
      await this.run([
        "proxy",
        "remove",
        CALLBACK_MAPPING.site,
        CALLBACK_MAPPING.prefix,
      ]);
  }
}
