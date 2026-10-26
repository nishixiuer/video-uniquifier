import { useCallback, useEffect, useState } from "react";
import { Alert, App, Spin } from "antd";
import type { PublishingSnapshot } from "../../shared/publishing";

export const invoke = <T,>(method: string, params: object = {}) =>
  window.electronAPI.publishing<T>(method, params);
export function usePublishing() {
  const [data, setData] = useState<PublishingSnapshot | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await invoke<PublishingSnapshot>("snapshot"));
      setError("");
    } catch {
      setError("无法读取本地发布数据，请重新启动应用。");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  const { message } = App.useApp();
  const run = async (
    method: string,
    params: object = {},
    success = "已保存",
  ) => {
    try {
      const result = await invoke(method, params);
      await refresh();
      if (success) message.success(success);
      return result;
    } catch (error) {
      message.error(String(error));
      throw error;
    }
  };
  return { data, error, refresh, run };
}
export function PublishingLoading({ error }: { error: string }) {
  return error ? <Alert type="error" message={error} /> : <Spin />;
}
