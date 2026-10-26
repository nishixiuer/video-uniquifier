export const CALLBACK_MAPPING = {
  site: "media-share",
  prefix: "/facebook/callback",
  upstream: "http://127.0.0.1:47135",
  redirectUri: "https://media-share.test/facebook/callback",
} as const;

export type CallbackMappingAdapter = {
  set: (enabled: boolean) => Promise<void>;
};
