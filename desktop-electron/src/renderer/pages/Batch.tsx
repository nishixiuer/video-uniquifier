import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  Segmented,
  Table,
  Tag,
} from "antd";
import { FolderOpenOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useStore } from "../store";
import { useDraft } from "../useDraft";
import { JobActions, JobProgress, PageTitle } from "../components";
import { NativeFields, ReelsFields } from "./Process";
import type { Job, Json, Method } from "../types";
import { fileName, terminal } from "../types";

export default function Batch({
  compare,
  report,
}: {
  compare: (job: Job) => void;
  report: (job: Job) => void;
}) {
  const { data, jobs, settings, submit } = useStore();
  const { message } = App.useApp();
  const [directory, setDirectory] = useDraft("batch:directory", "");
  const [output, setOutput] = useDraft("batch:output", "");
  const [files, setFiles] = useDraft<string[]>("batch:files", []);
  const [selected, setSelected] = useDraft<React.Key[]>("batch:selected", []);
  const [recursive, setRecursive] = useDraft("batch:recursive", false);
  const [filter, setFilter] = useDraft("batch:filter", "");
  const [method, setMethod] = useDraft<Method>("batch:method", settings.method);
  const [rules, setRules] = useDraft<Json>(
    "batch:rules",
    structuredClone(data.rules),
  );
  const [native, setNative] = useDraft<Json>("batch:native", { fast_qa: true });
  const [submitting, setSubmitting] = useState(false);
  const [jobIds, setJobIds] = useDraft<string[]>("batch:jobs", []);
  const batchJobs = jobs.filter((job) => jobIds.includes(job.id));
  const busy = submitting || batchJobs.some((job) => !terminal(job));
  const load = async (path: string, deep = recursive) => {
    const next = await window.electronAPI.list(path, deep);
    setFiles(next);
    setSelected(next);
  };
  const pick = async () => {
    try {
      const [path] = await window.electronAPI.pick("directory");
      if (path) {
        setDirectory(path);
        await load(path);
      }
    } catch (failure) {
      message.error(String(failure));
    }
  };
  const start = async () => {
    setSubmitting(true);
    try {
      const ids: string[] = [];
      for (const source of files.filter(
        (file) =>
          selected.includes(file) &&
          fileName(file).toLowerCase().includes(filter.toLowerCase()),
      )) {
        const job = await submit({
          kind: method,
          source,
          output_dir: output || undefined,
          rules,
          ...native,
          mode: "export",
        });
        ids.push(job.id);
      }
      setJobIds(ids);
      message.success(`已加入 ${ids.length} 个视频，按顺序处理`);
    } catch (failure) {
      message.error(String(failure));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <PageTitle
        title="批量处理"
        detail="先筛选素材与处理方式，再按顺序交付。每个成片都有独立的对比与质量报告。"
      />
      <Card bordered={false}>
        <div className="batch-top">
          <div>
            <span className="section-label">素材来源</span>
            <h2>{directory ? fileName(directory) : "选择一个素材文件夹"}</h2>
            <p className="muted truncate">
              {directory || "支持多选、文件名筛选和子文件夹扫描"}
            </p>
          </div>
          <Button icon={<FolderOpenOutlined />} disabled={busy} onClick={pick}>
            选择文件夹
          </Button>
        </div>
        <div className="batch-controls">
          <Segmented
            disabled={busy}
            value={method}
            onChange={(value) => setMethod(value as Method)}
            options={[
              { label: "短剧交付 · 默认", value: "reels" },
              { label: "通用视频处理", value: "native" },
            ]}
          />
          <Checkbox
            disabled={busy}
            checked={recursive}
            onChange={(event) => {
              setRecursive(event.target.checked);
              if (directory)
                void load(directory, event.target.checked).catch((failure) =>
                  message.error(String(failure)),
                );
            }}
          >
            包含子文件夹
          </Checkbox>
          <Input
            aria-label="筛选视频文件名"
            placeholder="按文件名筛选"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <Collapse
          ghost
          items={[
            {
              key: "settings",
              label: "统一处理参数",
              children:
                method === "reels" ? (
                  <ReelsFields rules={rules} onChange={setRules} />
                ) : (
                  <Form layout="vertical">
                    <NativeFields value={native} onChange={setNative} />
                  </Form>
                ),
            },
          ]}
        />
        <div className="batch-output">
          <span>输出位置</span>
          <Button
            onClick={async () => {
              const [path] = await window.electronAPI.pick("directory");
              if (path) setOutput(path);
            }}
          >
            {output || "使用应用默认目录"}
          </Button>
        </div>
        {method === "reels" && (
          <Alert
            type="info"
            showIcon
            message="短剧交付支持 MP4、MOV、MKV，其他扩展名会由原处理引擎提示。"
          />
        )}
      </Card>
      <Card className="mt-5" bordered={false}>
        <div className="table-title">
          <h3>
            素材清单 <Tag>{selected.length} 已选</Tag>
          </h3>
          <Button
            type="primary"
            loading={submitting}
            disabled={!selected.length || busy}
            icon={<PlayCircleOutlined />}
            onClick={start}
          >
            开始批量处理
          </Button>
        </div>
        <Table
          rowKey="path"
          pagination={{ pageSize: 8 }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          dataSource={files
            .filter((path) =>
              fileName(path).toLowerCase().includes(filter.toLowerCase()),
            )
            .map((path) => ({ path, name: fileName(path) }))}
          columns={[
            { title: "视频文件", dataIndex: "name" },
            { title: "目录", dataIndex: "path", ellipsis: true },
          ]}
          locale={{ emptyText: "选择文件夹后在此显示视频" }}
        />
      </Card>
      {batchJobs.map((job) => (
        <div className="batch-job" key={job.id}>
          <div className="flex items-center justify-between gap-4">
            <strong>{job.name}</strong>
            <JobActions job={job} compare={compare} report={report} />
          </div>
          <JobProgress job={job} />
        </div>
      ))}
    </>
  );
}
