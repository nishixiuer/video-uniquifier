import { useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Form,
  Select,
  Space,
  Table,
  Tabs,
} from "antd";
import { call, useStore } from "../store";
import { FileField, JobProgress, PageTitle } from "../components";
import { History } from "./Library";
import { terminal, type Job, type Json } from "../types";

export default function Queue({
  compare,
  report,
}: {
  compare: (job: Job) => void;
  report: (job: Job) => void;
}) {
  const { data, jobs, submit } = useStore();
  const { message } = App.useApp();
  const [root, setRoot] = useState("");
  const [output, setOutput] = useState("");
  const [profile, setProfile] = useState<string>();
  const [state, setState] = useState<Json | null>(null);
  const [jobId, setJobId] = useState("");
  const job = jobs.find((entry) => entry.id === jobId);
  const busy = Boolean(job && !terminal(job));
  const operate = async (method: string) => {
    try {
      const files =
        method === "queue.add"
          ? await window.electronAPI.pick("video", true)
          : undefined;
      setState(await call<Json>(method, { root, files }));
    } catch (failure) {
      message.error(String(failure));
    }
  };
  useEffect(() => {
    if (!root || !state) return;
    const timer = setInterval(() => {
      void call<Json>("queue.status", { root })
        .then(setState)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [root, Boolean(state)]);
  const start = async () => {
    try {
      const created = await submit({
        kind: "filequeue",
        source: root,
        output_dir: output,
        profile,
      });
      setJobId(created.id);
    } catch (failure) {
      message.error(String(failure));
    }
  };
  return (
    <Tabs
      items={[
        {
          key: "tasks",
          label: "应用任务",
          children: <History queue compare={compare} report={report} />,
        },
        {
          key: "filesystem",
          label: "目录队列",
          children: (
            <>
              <PageTitle
                title="目录队列"
                detail="兼容原项目的 FileQueue：初始化、加入文件、恢复失效租约及处理。"
              />
              <Card bordered={false}>
                <FileField
                  label="队列目录"
                  directory
                  path={root}
                  onChange={(value) => {
                    setRoot(value);
                    setState(null);
                  }}
                />
                <FileField
                  label="输出目录"
                  directory
                  path={output}
                  onChange={setOutput}
                />
                <Form layout="vertical">
                  <Form.Item label="处理配置">
                    <Select
                      value={profile}
                      placeholder="默认轻柔配置"
                      options={data.profiles.map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                      }))}
                      onChange={setProfile}
                    />
                  </Form.Item>
                </Form>
                <Space wrap>
                  <Button
                    disabled={!root}
                    onClick={() => operate("queue.init")}
                  >
                    初始化队列
                  </Button>
                  <Button disabled={!root} onClick={() => operate("queue.add")}>
                    加入文件
                  </Button>
                  <Button
                    disabled={!root}
                    onClick={() => operate("queue.status")}
                  >
                    刷新
                  </Button>
                  <Button
                    disabled={!root}
                    onClick={() => operate("queue.recover")}
                  >
                    恢复失效租约
                  </Button>
                  <Button
                    type="primary"
                    disabled={!root || !output || !state || busy}
                    onClick={start}
                  >
                    处理目录队列
                  </Button>
                </Space>
                <Alert
                  className="mt-5"
                  showIcon
                  type="info"
                  message="加入文件时由原 FileQueue 建立链接或副本，原素材保留；处理后队列中的素材归档至 done。队列清空时自动停止。"
                />
                <JobProgress job={job} />
                {state && (
                  <Table
                    className="mt-5"
                    rowKey="path"
                    dataSource={state.files}
                    columns={[
                      { title: "文件名", dataIndex: "name" },
                      {
                        title: "状态",
                        dataIndex: "bucket",
                        render: (bucket: string) =>
                          ({
                            pending: "等待处理",
                            in_progress: "处理中",
                            done: "已完成",
                            failed: "失败",
                          })[bucket] || bucket,
                      },
                    ]}
                  />
                )}
              </Card>
            </>
          ),
        },
      ]}
    />
  );
}
