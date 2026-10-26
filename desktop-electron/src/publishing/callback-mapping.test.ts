import { describe, expect, it, vi } from "vitest";
import { YerdCallbackMapping } from "./callback-mapping";
import { CALLBACK_MAPPING } from "../shared/callback-mapping";

const executeMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: executeMock,
  }),
}));

const ownRule: { site: string; prefix: string; target: string } = {
  site: CALLBACK_MAPPING.site,
  prefix: CALLBACK_MAPPING.prefix,
  target: CALLBACK_MAPPING.upstream,
};
function adapter(
  rules: (typeof ownRule)[] = [],
  proxies: { name: string }[] = [],
) {
  const run = vi.fn(async (args: string[]) =>
    args[1] === "list" ? JSON.stringify({ rules, proxies }) : '{"type":"ok"}',
  );
  return { run, mapping: new YerdCallbackMapping(run) };
}
describe("local Yerd callback mapping", () => {
  it("uses a bounded direct CLI invocation and keeps subprocess details out of errors", async () => {
    executeMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ rules: [], proxies: [] }),
      })
      .mockResolvedValueOnce({ stdout: '{"type":"ok"}' });
    await new YerdCallbackMapping().set(true);
    expect(executeMock).toHaveBeenCalledWith(
      "/Applications/Yerd.app/Contents/MacOS/yerd",
      ["--json", "proxy", "list"],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    executeMock.mockRejectedValueOnce(new Error("PRIVATE_SUBPROCESS_DETAILS"));
    await expect(new YerdCallbackMapping().set(false)).rejects.toThrow(
      "请确认已安装并启动 Yerd",
    );
  });
  it("adds only the dedicated callback path and leaves other routes alone", async () => {
    const { run, mapping } = adapter([{ ...ownRule, prefix: "/other" }]);
    await mapping.set(true);
    expect(run.mock.calls).toEqual([
      [["proxy", "list"]],
      [
        [
          "proxy",
          "add",
          "media-share",
          "/facebook/callback",
          "http://127.0.0.1:47135",
        ],
      ],
    ]);
  });
  it("reuses a matching rule and removes only that rule when disabled", async () => {
    const { run, mapping } = adapter([ownRule]);
    await mapping.set(true);
    expect(run).toHaveBeenCalledTimes(1);
    await mapping.set(false);
    expect(run).toHaveBeenLastCalledWith([
      "proxy",
      "remove",
      "media-share",
      "/facebook/callback",
    ]);
  });
  it("is safe to disable an already absent mapping", async () => {
    const { run, mapping } = adapter();
    await mapping.set(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])(
    "refuses to overwrite/remove another upstream (%s)",
    async (enabled) => {
      const { run, mapping } = adapter([
        { ...ownRule, target: "http://127.0.0.1:9999" },
      ]);
      await expect(mapping.set(enabled)).rejects.toThrow("其他代理");
      expect(run).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses a conflicting whole-host proxy", async () => {
    const { run, mapping } = adapter([], [{ name: "media-share" }]);
    await expect(mapping.set(true)).rejects.toThrow("整站代理");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed configuration and propagates a failed mutation", async () => {
    const malformed = new YerdCallbackMapping(async () => "{}");
    await expect(malformed.set(true)).rejects.toThrow("格式无效");
    const { run, mapping } = adapter();
    run.mockRejectedValueOnce(new Error("Yerd 未启动"));
    await expect(mapping.set(true)).rejects.toThrow("未启动");
    run
      .mockResolvedValueOnce(JSON.stringify({ rules: [], proxies: [] }))
      .mockRejectedValueOnce(new Error("写入失败"));
    await expect(mapping.set(true)).rejects.toThrow("写入失败");
  });
});
