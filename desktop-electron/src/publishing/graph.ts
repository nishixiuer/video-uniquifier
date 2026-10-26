import { createHmac } from "node:crypto";
import { openAsBlob } from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { AppConfig, Media, Post } from "../shared/publishing";

type Data = Record<string, any>;
export class GraphError extends Error {
  constructor(
    message: string,
    public code?: number,
    public ambiguous = false,
  ) {
    super(message);
  }
}
export type Fetch = typeof fetch;
export const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
];

export class FacebookGraph {
  constructor(
    private config: AppConfig,
    private secret: string,
    private request: Fetch = fetch,
  ) {}

  authorizationUrl(state: string) {
    const url = new URL(
      `https://www.facebook.com/${this.config.version}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      state,
      scope: SCOPES.join(","),
    }).toString();
    return url.toString();
  }

  private async decode(response: Response): Promise<Data> {
    let data: Data;
    try {
      data = await response.json();
    } catch {
      throw new GraphError(
        "Meta 返回无法解析的结果，请核实发布状态。",
        undefined,
        true,
      );
    }
    if (!response.ok || data.error) {
      const code = Number(data.error?.code) || undefined;
      // Do not echo provider messages which may contain tokens or URLs.
      const reason =
        code === 190
          ? "授权已过期，请重新授权主页。"
          : [10, 200].includes(code || 0)
            ? "应用缺少发帖权限，或当前用户没有该主页的发布权限。"
            : [4, 17, 32, 613].includes(code || 0)
              ? "Meta 请求频率受限，请稍后重试。"
              : "Meta 拒绝请求，请检查应用权限、媒体格式及 API 设置。";
      throw new GraphError(
        `${reason}（HTTP ${response.status}${code ? ` / code ${code}` : ""}）`,
        code,
        response.status >= 500,
      );
    }
    return data;
  }

  async api(
    path: string,
    token: string,
    fields: Record<string, string> = {},
    method = "GET",
    video = false,
  ): Promise<Data> {
    if (!/^[\w/-]+$/.test(path)) throw new Error("无效的 Meta 接口路径。");
    const url = new URL(
      `https://${video ? "graph-video" : "graph"}.facebook.com/${this.config.version}/${path}`,
    );
    const params = new URLSearchParams(fields);
    if (this.secret && token)
      params.set(
        "appsecret_proof",
        createHmac("sha256", this.secret).update(token).digest("hex"),
      );
    if (method === "GET") url.search = params.toString();
    try {
      const response = await this.request(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        ...(method === "GET" ? {} : { body: params }),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      return await this.decode(response);
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(
        "无法连接 Meta，连接中断后的发布结果需要核实。",
        undefined,
        method !== "GET",
      );
    }
  }

  async exchange(code: string) {
    const token = await this.api("oauth/access_token", "", {
      client_id: this.config.appId,
      client_secret: this.secret,
      redirect_uri: this.config.redirectUri,
      code,
    });
    if (!token.access_token) throw new GraphError("Meta 未返回用户令牌。");
    const long = await this.api("oauth/access_token", "", {
      client_id: this.config.appId,
      client_secret: this.secret,
      grant_type: "fb_exchange_token",
      fb_exchange_token: token.access_token,
    });
    if (!long.access_token) throw new GraphError("Meta 未返回长期用户令牌。");
    return String(long.access_token);
  }

  async discover(token: string) {
    const permissions = await this.api("me/permissions", token);
    const granted = new Set(
      (permissions.data || [])
        .filter((p: Data) => p.status === "granted")
        .map((p: Data) => p.permission),
    );
    const missing = SCOPES.filter((scope) => !granted.has(scope));
    if (missing.length)
      throw new GraphError(`授权缺少权限：${missing.join("、")}，请重新授权。`);
    const pages: Data[] = [];
    let after = "";
    const cursors = new Set<string>();
    for (let n = 0; n < 100; n++) {
      const response = await this.api("me/accounts", token, {
        fields: "id,name,access_token,tasks,category",
        limit: "100",
        ...(after ? { after } : {}),
      });
      for (const page of response.data || []) {
        if (/^\d+$/.test(String(page.id)) && page.access_token)
          pages.push(page);
      }
      if (!response.paging?.next) break;
      after = response.paging.cursors?.after;
      if (!after || cursors.has(after))
        throw new GraphError("Meta 主页分页异常，请重新同步。");
      cursors.add(after);
    }
    if (!pages.length)
      throw new GraphError(
        "没有可发布的主页，请确认授权时已选择主页，且用户拥有内容发布权限。",
      );
    return pages;
  }

  private async upload(
    pageId: string,
    token: string,
    media: Media,
    fields: Record<string, string>,
    video = false,
  ) {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    if (this.secret)
      body.set(
        "appsecret_proof",
        createHmac("sha256", this.secret).update(token).digest("hex"),
      );
    const mime =
      media.kind === "video"
        ? media.name.toLowerCase().endsWith(".mov")
          ? "video/quicktime"
          : "video/mp4"
        : media.name.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg";
    body.set(
      "source",
      await openAsBlob(media.path, { type: mime }),
      media.name,
    );
    try {
      return await this.decode(
        await this.request(
          `https://${video ? "graph-video" : "graph"}.facebook.com/${this.config.version}/${pageId}/${video ? "videos" : "photos"}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
            signal: AbortSignal.timeout(30 * 60_000),
            redirect: "error",
          },
        ),
      );
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError("媒体上传中断，发布结果需要核实。", undefined, true);
    }
  }

  photo(pageId: string, token: string, media: Media) {
    return this.upload(pageId, token, media, { published: "false" });
  }
  video(pageId: string, token: string, post: Post) {
    return this.upload(
      pageId,
      token,
      post.media[0],
      { description: post.copy },
      true,
    );
  }
  feed(pageId: string, token: string, message: string, photoIds: string[]) {
    return this.api(
      `${pageId}/feed`,
      token,
      {
        message,
        ...Object.fromEntries(
          photoIds.map((id, index) => [
            `attached_media[${index}]`,
            JSON.stringify({ media_fbid: id }),
          ]),
        ),
      },
      "POST",
    );
  }
  async startReel(pageId: string, token: string) {
    const data = await this.api(
      `${pageId}/video_reels`,
      token,
      { upload_phase: "start" },
      "POST",
    );
    if (!/^\d+$/.test(String(data.video_id)))
      throw new GraphError("Meta 未返回视频上传编号。", undefined, true);
    const url = new URL(String(data.upload_url));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "rupload.facebook.com" ||
      url.username ||
      url.password ||
      url.port
    )
      throw new GraphError("Meta 返回了无效的上传地址。");
    return { id: String(data.video_id), url: url.toString() };
  }
  async uploadReel(url: string, token: string, media: Media) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.hostname !== "rupload.facebook.com" ||
      target.username ||
      target.password ||
      target.port
    )
      throw new GraphError("无效的视频上传地址。");
    const info = await stat(media.path);
    const stream = createReadStream(media.path);
    stream.on("error", () => {
      /* The request reports upload errors without leaking local paths. */
    });
    try {
      const response = await this.request(target, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${token}`,
          offset: "0",
          file_size: String(info.size),
          "Content-Type": "application/octet-stream",
        },
        body: stream as unknown as BodyInit,
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(30 * 60_000),
      } as RequestInit);
      const data = await this.decode(response);
      if (data.success !== true)
        throw new GraphError("Meta 未确认视频已上传。", undefined, true);
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(
        "Reels 上传中断，请核实远端视频状态。",
        undefined,
        true,
      );
    } finally {
      stream.destroy();
    }
  }
  finishReel(pageId: string, token: string, videoId: string, post: Post) {
    return this.api(
      `${pageId}/video_reels`,
      token,
      {
        upload_phase: "finish",
        video_id: videoId,
        video_state: "PUBLISHED",
        title: post.title,
        description: post.copy,
      },
      "POST",
    );
  }
  status(videoId: string, token: string) {
    return this.api(videoId, token, { fields: "status" });
  }
}
