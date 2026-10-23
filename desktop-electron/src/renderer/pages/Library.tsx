import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import { FolderAddOutlined, ReloadOutlined } from "@ant-design/icons";
import { call, useStore } from "../store";
import {
  FileField,
  JobActions,
  JobProgress,
  PageTitle,
  Status,
} from "../components";
import { fileName, kindLabel, terminal, type Job, type Json } from "../types";

export function History({
  queue,
  compare,
  report,
}: {
  queue?: boolean;
  compare: (job: Job) => void;
  report: (job: Job) => void;
}) {
  const { jobs, action, refresh } = useStore();
  const { message } = App.useApp();
  const importHistory = async () => {
    try {
      const [path] = await window.electronAPI.pick("history");
      if (!path) return;
      const count = await call<number>("history.import", { path });
      await refresh();
      message.success(`已导入 ${count} 条旧版历史记录`);
    } catch (failure) {
      message.error(String(failure));
    }
  };
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const records = [...jobs]
    .sort((a, b) => b.created_at - a.created_at)
    .filter(
      (job) =>
        (!queue || !terminal(job)) &&
        job.name.toLowerCase().includes(query.toLowerCase()) &&
        (status === "all" || job.status === status),
    );
  const active = jobs.filter((job) => !terminal(job));
  return (
    <>
      <PageTitle
        title={queue ? "处理队列" : "历史记录"}
        detail={
          queue
            ? "统一管理后台处理任务。切换页面不会打断编码。"
            : "原片、成片、报告都保留本地路径，重新启动后仍可打开。"
        }
        extra={
          queue ? (
            <Popconfirm
              title="取消所有正在处理和等待的任务？"
              onConfirm={async () => {
                for (const job of active) await action(job, "cancel");
              }}
            >
              <Button danger disabled={!active.length}>
                取消全部
              </Button>
            </Popconfirm>
          ) : (
            <Button onClick={importHistory}>导入旧版历史</Button>
          )
        }
      />
      <div className="summary-strip">
        <div>
          <small>处理中</small>
          <strong>{active.length}</strong>
        </div>
        <div>
          <small>已完成</small>
          <strong>
            {jobs.filter((job) => job.status === "success").length}
          </strong>
        </div>
        <div>
          <small>失败 / 已取消</small>
          <strong>
            {
              jobs.filter((job) => ["failed", "cancelled"].includes(job.status))
                .length
            }
          </strong>
        </div>
      </div>
      <Card bordered={false}>
        <div className="table-toolbar">
          <Input.Search
            placeholder="搜索视频文件名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            allowClear
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "所有状态" },
              { value: "success", label: "已完成" },
              { value: "running", label: "处理中" },
              { value: "queued", label: "等待处理" },
              { value: "failed", label: "失败" },
              { value: "cancelled", label: "已取消" },
            ]}
          />
        </div>
        <Table
          rowKey="id"
          dataSource={records}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          expandable={{ expandedRowRender: (job) => <JobProgress job={job} /> }}
          columns={[
            {
              title: "素材",
              dataIndex: "name",
              ellipsis: true,
              width: "25%",
              render: (name: string, job: Job) => (
                <div>
                  <strong>{name}</strong>
                  <small className="table-subline">
                    {kindLabel(job.kind)} ·{" "}
                    {job.mode === "sample"
                      ? "样片"
                      : job.mode === "preflight"
                        ? "检查"
                        : "完整处理"}
                  </small>
                </div>
              ),
            },
            {
              title: "时间",
              dataIndex: "created_at",
              render: (time: number) =>
                new Date(time * 1000).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
            },
            {
              title: "状态",
              render: (_: unknown, job: Job) => <Status job={job} />,
            },
            {
              title: "操作",
              width: "38%",
              render: (_: unknown, job: Job) => (
                <Space wrap>
                  <JobActions job={job} compare={compare} report={report} />
                  {!terminal(job) && (
                    <Button
                      danger
                      size="small"
                      onClick={() => action(job, "cancel")}
                    >
                      取消
                    </Button>
                  )}
                  {!job.params.imported &&
                    ["failed", "cancelled"].includes(job.status) && (
                      <Button size="small" onClick={() => action(job, "retry")}>
                        重试
                      </Button>
                    )}
                </Space>
              ),
            },
          ]}
          locale={{
            emptyText: queue
              ? "当前没有排队或正在处理的任务"
              : "处理完成后可在这里查看对比和报告",
          }}
        />
      </Card>
    </>
  );
}

export function Quality({ report }: { report: (job: Job) => void }) {
  const { jobs, submit } = useStore();
  const { message } = App.useApp();
  const [source, setSource] = useState("");
  const [output, setOutput] = useState("");
  const [fast, setFast] = useState(false);
  const [corpus, setCorpus] = useState(false);
  const [pending, setPending] = useState(false);
  const [jobId, setJobId] = useState("");
  const job = jobs.find((item) => item.id === jobId);
  const start = async () => {
    setPending(true);
    try {
      const created = await submit({
        kind: "qa",
        source,
        comparison: output,
        fast_qa: fast,
        vs_corpus: corpus,
      });
      setJobId(created.id);
    } catch (failure) {
      message.error(String(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <PageTitle
        title="质量报告"
        detail="查看交付报告，或为任意一对原片与成片重新测量画面和声音。"
      />
      <Tabs
        items={[
          {
            key: "reports",
            label: "已有报告",
            children: (
              <Card bordered={false}>
                <Table
                  rowKey="id"
                  dataSource={[...jobs].filter((item) => item.report).reverse()}
                  columns={[
                    { title: "视频", dataIndex: "name" },
                    { title: "处理方式", dataIndex: "kind", render: kindLabel },
                    {
                      title: "状态",
                      render: (_: unknown, entry: Job) => (
                        <Status job={entry} />
                      ),
                    },
                    {
                      title: "报告",
                      render: (_: unknown, entry: Job) => (
                        <Button onClick={() => report(entry)}>查看报告</Button>
                      ),
                    },
                  ]}
                  locale={{ emptyText: "尚无质量报告" }}
                />
              </Card>
            ),
          },
          {
            key: "compute",
            label: "重新检测",
            children: (
              <Card bordered={false}>
                <h2>选择对比文件</h2>
                <FileField
                  label="原始视频"
                  path={source}
                  onChange={setSource}
                />
                <FileField
                  label="处理成片"
                  path={output}
                  onChange={setOutput}
                />
                <Space wrap className="my-5">
                  <Checkbox
                    checked={fast}
                    onChange={(event) => setFast(event.target.checked)}
                  >
                    快速抽样（跳过 VMAF / SSIM）
                  </Checkbox>
                  <Checkbox
                    checked={corpus}
                    onChange={(event) => setCorpus(event.target.checked)}
                  >
                    同时对照参考素材库
                  </Checkbox>
                </Space>
                <div>
                  <Button
                    type="primary"
                    disabled={
                      !source || !output || Boolean(job && !terminal(job))
                    }
                    loading={pending}
                    onClick={start}
                  >
                    生成质量报告
                  </Button>
                </div>
                <JobProgress job={job} />
                {job?.report && (
                  <Button onClick={() => report(job)}>打开报告</Button>
                )}
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}

export function CorpusPage() {
  const { jobs, submit } = useStore();
  const { message } = App.useApp();
  const [entries, setEntries] = useState<Json[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      setEntries(await call<Json[]>("corpus.list"));
    } catch (failure) {
      message.error(String(failure));
    } finally {
      setLoading(false);
    }
  };
  const corpusJobs = jobs.filter((job) => job.kind === "corpus");
  const signature = corpusJobs
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  useEffect(() => {
    void refresh();
  }, [signature]);
  const add = async () => {
    try {
      const paths = await window.electronAPI.pick("video", true);
      for (const source of paths) await submit({ kind: "corpus", source });
    } catch (failure) {
      message.error(String(failure));
    }
  };
  return (
    <>
      <PageTitle
        title="参考素材库"
        detail="建立自有视频的本地指纹索引，用于后续质量和相似度诊断。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
            <Button type="primary" icon={<FolderAddOutlined />} onClick={add}>
              添加视频
            </Button>
          </Space>
        }
      />
      <Card bordered={false}>
        <Table
          loading={loading}
          rowKey="id"
          dataSource={entries}
          columns={[
            {
              title: "视频",
              dataIndex: "path",
              render: (path: string) => (
                <span title={path}>{fileName(path)}</span>
              ),
            },
            {
              title: "时长（秒）",
              dataIndex: "duration_sec",
              render: (value: number) => value.toFixed(1),
            },
            { title: "采样数", dataIndex: "sample_count" },
            {
              title: "音频指纹",
              dataIndex: "audio_fingerprint",
              render: (value: number[]) =>
                value.length ? <Tag color="success">已生成</Tag> : "无",
            },
            {
              title: "操作",
              render: (_: unknown, entry: Json) => (
                <Popconfirm
                  title="仅移除索引，保留原始视频？"
                  onConfirm={async () => {
                    await call("corpus.remove", { id: entry.id });
                    await refresh();
                  }}
                >
                  <Button danger type="text">
                    移除索引
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
          locale={{ emptyText: "添加已授权视频，建立本地参考库" }}
        />
      </Card>
      {corpusJobs
        .filter((job) => !terminal(job))
        .map((job) => (
          <JobProgress key={job.id} job={job} />
        ))}
    </>
  );
}
