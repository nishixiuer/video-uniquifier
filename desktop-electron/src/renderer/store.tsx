import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { App as AntApp, Spin, Result, Button } from "antd";
import type { Bootstrap, Job, Json, Settings } from "./types";
import { mergeJobs } from "./jobs";

type Store = {
  data: Bootstrap;
  jobs: Job[];
  settings: Settings;
  error: string;
  refresh: () => Promise<void>;
  submit: (params: Json) => Promise<Job>;
  action: (job: Job, action: string) => Promise<void>;
  setSettings: (settings: Settings) => Promise<void>;
};
const Context = createContext<Store | null>(null);
export const useStore = () => useContext(Context)!;
export const call = <T,>(method: string, params?: object) =>
  window.electronAPI.call<T>(method, params);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [settings, updateSettings] = useState<Settings>({
    language: "zh_CN",
    theme: "dark",
    method: "reels",
    reducedMotion: false,
  });
  const refresh = async () => {
    try {
      const next = await call<Bootstrap>("bootstrap");
      setData(next);
      setJobs((current) => mergeJobs(current, next.jobs));
      setError("");
    } catch (failure) {
      setError(String(failure));
    }
  };
  useEffect(() => {
    const unJob = window.electronAPI.onJob((job) => {
      setJobs((current) => mergeJobs(current, [job]));
    });
    const unError = window.electronAPI.onError(setError);
    void refresh();
    void window.electronAPI
      .readSettings()
      .then(updateSettings)
      .catch((failure) => message.error(String(failure)));
    return () => {
      unJob();
      unError();
    };
  }, []);
  const setSettings = async (next: Settings) => {
    try {
      await window.electronAPI.saveSettings(next);
      updateSettings(next);
      message.success("偏好设置已保存");
    } catch (failure) {
      message.error(String(failure));
    }
  };
  const submit = async (params: Json) => {
    const job = await call<Job>("jobs.submit", params);
    setJobs((current) => mergeJobs(current, [job]));
    return job;
  };
  const action = async (job: Job, operation: string) => {
    try {
      const next = await call<Job>("jobs.action", {
        id: job.id,
        action: operation,
      });
      setJobs((current) => mergeJobs(current, [next]));
    } catch (failure) {
      message.error(String(failure));
    }
  };
  if (!data)
    return (
      <div className="boot-screen">
        {error ? (
          <Result
            status="error"
            title="处理引擎启动失败"
            subTitle={error}
            extra={<Button onClick={refresh}>重试连接</Button>}
          />
        ) : (
          <Spin tip="正在启动本地视频引擎…" size="large">
            <div className="boot-spacer" />
          </Spin>
        )}
      </div>
    );
  return (
    <Context.Provider
      value={{
        data,
        jobs,
        settings,
        error,
        refresh,
        submit,
        action,
        setSettings,
      }}
    >
      {children}
    </Context.Provider>
  );
}
