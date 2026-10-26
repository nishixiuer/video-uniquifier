import { describe, it, expect, vi } from "vitest";
import { FacebookGraph, GraphError, SCOPES } from "./graph";
import type { AppConfig } from "../shared/publishing";

const config: AppConfig = {
  appId: "123",
  version: "v26.0",
  redirectUri: "https://example.com/callback",
  hasSecret: true,
};
function adapter(
  reply: (url: URL, init: RequestInit) => unknown | Promise<unknown>,
) {
  const request = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const data = await reply(new URL(String(input)), init);
    return data instanceof Response ? data : Response.json(data);
  });
  return {
    graph: new FacebookGraph(config, "SECRET", request as typeof fetch),
    request,
  };
}
describe("Facebook Graph adapter", () => {
  it("builds least-privilege OAuth and signs authenticated requests without query tokens", async () => {
    const { graph, request } = adapter(() => ({ id: "42" }));
    const url = new URL(graph.authorizationUrl("STATE"));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(","));
    expect(url.searchParams.get("state")).toBe("STATE");
    await graph.api("42", "TOKEN");
    const [target, init] = request.mock.calls[0];
    expect(new URL(String(target)).searchParams.has("access_token")).toBe(
      false,
    );
    expect(new URL(String(target)).searchParams.get("appsecret_proof")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(init!.headers).toEqual({ Authorization: "Bearer TOKEN" });
    expect(init!.redirect).toBe("error");
    await expect(graph.api("https://evil.test", "TOKEN")).rejects.toThrow(
      "无效",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    [190, "授权已过期"],
    [10, "权限"],
    [200, "权限"],
    [4, "频率"],
    [17, "频率"],
    [999, "拒绝请求"],
  ])("sanitizes provider error %s", async (code, message) => {
    const { graph } = adapter(() =>
      Response.json(
        { error: { code, message: "SECRET TOKEN" } },
        { status: 400 },
      ),
    );
    try {
      await graph.api("42/feed", "TOKEN", {}, "POST");
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphError);
      expect(String(error)).toContain(message);
      expect(String(error)).not.toContain("SECRET");
      expect((error as GraphError).ambiguous).toBe(false);
    }
  });
  it("distinguishes server/network uncertainty and malformed responses", async () => {
    const { graph } = adapter(() =>
      Response.json({ error: {} }, { status: 503 }),
    );
    await expect(graph.feed("42", "TOKEN", "hello", [])).rejects.toMatchObject({
      ambiguous: true,
    });
    const malformed = adapter(() => new Response("not-json")).graph;
    await expect(malformed.status("88", "TOKEN")).rejects.toMatchObject({
      ambiguous: true,
    });
    const offline = adapter(() => {
      throw new Error("TOKEN in network URL");
    }).graph;
    await expect(offline.status("88", "TOKEN")).rejects.toMatchObject({
      ambiguous: false,
    });
    await expect(offline.feed("42", "TOKEN", "test", [])).rejects.toMatchObject(
      { ambiguous: true },
    );
    await expect(offline.feed("42", "TOKEN", "test", [])).rejects.not.toThrow(
      "TOKEN",
    );
  });
  it("exchanges both short and long tokens and validates missing results", async () => {
    const { graph, request } = adapter((url) => ({
      access_token: url.searchParams.has("code") ? "SHORT" : "LONG",
    }));
    expect(await graph.exchange("CODE")).toBe("LONG");
    expect(
      new URL(String(request.mock.calls[1][0])).searchParams.get(
        "fb_exchange_token",
      ),
    ).toBe("SHORT");
    await expect(adapter(() => ({})).graph.exchange("CODE")).rejects.toThrow(
      "用户令牌",
    );
    await expect(
      adapter((url) =>
        url.searchParams.has("code") ? { access_token: "SHORT" } : {},
      ).graph.exchange("CODE"),
    ).rejects.toThrow("长期");
  });
  it("requires granted permissions before requesting pages", async () => {
    const { graph, request } = adapter(() => ({
      data: [{ permission: SCOPES[0], status: "declined" }],
    }));
    await expect(graph.discover("TOKEN")).rejects.toThrow("缺少权限");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("follows cursors only against the official host, ignoring remote next URLs", async () => {
    const { graph, request } = adapter((url) => {
      if (url.pathname.endsWith("permissions"))
        return {
          data: SCOPES.map((permission) => ({ permission, status: "granted" })),
        };
      return url.searchParams.has("after")
        ? { data: [{ id: "2", access_token: "PAGE2" }] }
        : {
            data: [
              { id: "1", access_token: "PAGE1" },
              { id: "invalid", access_token: "secret" },
            ],
            paging: {
              next: "https://evil.test/token",
              cursors: { after: "CURSOR" },
            },
          };
    });
    expect((await graph.discover("TOKEN")).map((page) => page.id)).toEqual([
      "1",
      "2",
    ]);
    expect(
      request.mock.calls.every(
        ([target]) => new URL(String(target)).hostname === "graph.facebook.com",
      ),
    ).toBe(true);
    expect(
      new URL(String(request.mock.calls[2][0])).searchParams.get("after"),
    ).toBe("CURSOR");
  });
  it("rejects empty pages and repeated pagination cursors", async () => {
    const permissions = {
      data: SCOPES.map((permission) => ({ permission, status: "granted" })),
    };
    await expect(
      adapter((url) =>
        url.pathname.endsWith("permissions") ? permissions : { data: [] },
      ).graph.discover("TOKEN"),
    ).rejects.toThrow("没有可发布");
    await expect(
      adapter((url) =>
        url.pathname.endsWith("permissions")
          ? permissions
          : {
              data: [],
              paging: { next: "anything", cursors: { after: "same" } },
            },
      ).graph.discover("TOKEN"),
    ).rejects.toThrow("分页异常");
  });
  it("encodes multiple unpublished photos in one feed request", async () => {
    const { graph, request } = adapter(() => ({ id: "42_55" }));
    await graph.feed("42", "TOKEN", "正文", ["11", "12"]);
    const params = request.mock.calls[0][1]!.body as URLSearchParams;
    expect(params.get("message")).toBe("正文");
    expect(JSON.parse(params.get("attached_media[1]")!)).toEqual({
      media_fbid: "12",
    });
  });
  it.each([
    "http://rupload.facebook.com/video",
    "https://evil.test/video",
    "https://rupload.facebook.com.evil.test/video",
    "https://user:pass@rupload.facebook.com/video",
    "https://rupload.facebook.com:444/video",
  ])(
    "rejects an untrusted Reel upload target %s before exposing a token",
    async (upload_url) => {
      const { graph, request } = adapter(() => ({
        video_id: "88",
        upload_url,
      }));
      await expect(graph.startReel("42", "TOKEN")).rejects.toThrow("上传地址");
      await expect(
        graph.uploadReel(upload_url, "TOKEN", {} as never),
      ).rejects.toThrow("上传地址");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects missing Reel video IDs", async () => {
    await expect(
      adapter(() => ({ video_id: "oops" })).graph.startReel("42", "TOKEN"),
    ).rejects.toThrow("上传编号");
  });
});
