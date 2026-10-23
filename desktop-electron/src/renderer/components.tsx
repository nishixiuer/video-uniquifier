import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Empty,
  Modal,
  Progress,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  FolderOpenOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { Job, Json } from "./types";
import {
  fileName,
  kindLabel,
  stageLabel,
  statusLabel,
  terminal,
} from "./types";
import { call, useStore } from "./store";
import { reportRows } from "./report";

export function PageTitle({
  title,
  detail,
  extra,
}: {
  title: string;
  detail: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {extra}
    </div>
  );
}
export function FileField({
  label,
  path,
  directory,
  onChange,
}: {
  label: string;
  path: string;
  directory?: boolean;
  onChange: (value: string) => void;
}) {
  const { message } = App.useApp();
  const pick = async () => {
    try {
      const [next] = await window.electronAPI.pick(
        directory ? "directory" : "video",
      );
      if (next) onChange(next);
    } catch (failure) {
      message.error(String(failure));
    }
  };
  return (
    <div className="file-field">
      <div className="field-icon">
        <FolderOpenOutlined />
      </div>
      <div className="min-w-0 flex-1">
        <label>{label}</label>
        <strong title={path}>
          {path
            ? fileName(path)
            : directory
              ? "使用应用默认目录"
              : "选择本地视频"}
        </strong>
        <small title={path}>
          {path ||
            (directory
              ? "处理完成后可在历史记录中找到结果"
              : "MP4 / MOV / MKV / WEBM")}
        </small>
      </div>
      <Button onClick={pick}>{path ? "更换" : "选择"}</Button>
    </div>
  );
}
export function Status({ job }: { job: Job }) {
  return (
    <Tag
      color={
        {
          success: "success",
          failed: "error",
          cancelled: "default",
          running: "processing",
          paused: "warning",
          queued: "default",
        }[job.status]
      }
    >
      {statusLabel(job.status)}
    </Tag>
  );
}
export function JobProgress({ job }: { job?: Job }) {
  const { action } = useStore();
  if (!job) return null;
  return (
    <div className="job-progress">
      <div className="flex items-center justify-between gap-3">
        <strong>{stageLabel(job.stage)}</strong>
        <Space>
          <Status job={job} />
          {!terminal(job) &&
            job.kind === "native" &&
            job.status !== "queued" && (
              <Button
                size="small"
                onClick={() =>
                  action(job, job.status === "paused" ? "resume" : "pause")
                }
              >
                {job.status === "paused" ? "继续" : "暂停"}
              </Button>
            )}
          {!terminal(job) && (
            <Button size="small" danger onClick={() => action(job, "cancel")}>
              取消任务
            </Button>
          )}
          {!job.params.imported &&
            ["failed", "cancelled"].includes(job.status) && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => action(job, "retry")}
              >
                重试
              </Button>
            )}
        </Space>
      </div>
      <Progress
        percent={Math.round(job.progress * 100)}
        status={
          job.status === "failed"
            ? "exception"
            : job.status === "success"
              ? "success"
              : "normal"
        }
      />
      {job.error && <p className="error-text">{job.error}</p>}
      {job.mode === "preflight" && job.result && (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={reportRows(job.result)}
          columns={[
            { title: "检查项目", dataIndex: "label" },
            { title: "结果", dataIndex: "value" },
          ]}
        />
      )}
    </div>
  );
}
export function Video({
  path,
  className = "",
}: {
  path: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setUrl("");
    setError("");
    if (path)
      void window.electronAPI
        .mediaUrl(path)
        .then((next) => {
          if (current) setUrl(next);
        })
        .catch((failure) => {
          if (current) setError(String(failure));
        });
    return () => {
      current = false;
    };
  }, [path]);
  return (
    <div className={`video-wrap ${className}`}>
      {error ? (
        <Empty description={error} />
      ) : url ? (
        <video
          key={url}
          src={url}
          controls
          preload="metadata"
          onError={() =>
            setError(
              "当前素材编码无法在应用内播放，请确认文件可读且编码受支持。",
            )
          }
        />
      ) : (
        <Empty
          image={<PlayCircleOutlined />}
          description="选择视频后可在此预览"
        />
      )}
    </div>
  );
}
export function JobActions({
  job,
  compare,
  report,
}: {
  job: Job;
  compare: (job: Job) => void;
  report: (job: Job) => void;
}) {
  return (
    <Space wrap>
      {job.output && (
        <Button size="small" onClick={() => compare(job)}>
          视频对比
        </Button>
      )}
      {job.report && (
        <Button size="small" type="link" onClick={() => report(job)}>
          质量报告
        </Button>
      )}
      {job.output && (
        <Button
          size="small"
          type="text"
          icon={<FolderOpenOutlined />}
          onClick={() => window.electronAPI.reveal(job.output!)}
        >
          定位文件
        </Button>
      )}
    </Space>
  );
}
export function CompareModal({
  job,
  onClose,
}: {
  job: Job | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const original = useRef<HTMLVideoElement>(null);
  const output = useRef<HTMLVideoElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const offset = Number(job?.result?.source_offset || 0);
  useEffect(() => {
    setUrls([]);
    setPlaying(false);
    setDuration(0);
    setPosition(0);
    if (!job?.output) return;
    let mounted = true;
    void Promise.all([
      window.electronAPI.mediaUrl(job.source),
      window.electronAPI.mediaUrl(job.output),
    ])
      .then((next) => {
        if (mounted) setUrls(next);
      })
      .catch((failure) => message.error(String(failure)));
    return () => {
      mounted = false;
      original.current?.pause();
      output.current?.pause();
    };
  }, [job?.id]);
  const seek = (time: number) => {
    if (original.current) original.current.currentTime = time + offset;
    if (output.current) output.current.currentTime = time;
    setPosition(time);
  };
  const toggle = async () => {
    const a = original.current;
    const b = output.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
    } else {
      try {
        a.currentTime = b.currentTime + offset;
        await Promise.all([a.play(), b.play()]);
        setPlaying(true);
      } catch {
        a.pause();
        b.pause();
        setPlaying(false);
        message.error("无法播放，请确认原片和成片仍存在且编码受支持。");
      }
    }
  };
  return (
    <Modal
      open={Boolean(job)}
      onCancel={onClose}
      footer={null}
      width={1180}
      destroyOnHidden
      title={
        <span>
          视频对比 <small className="muted">／ {job?.name}</small>
        </span>
      }
    >
      <div className="compare-grid">
        <div>
          <div className="compare-label">
            原始视频 <span>声音关闭</span>
          </div>
          <video
            ref={original}
            src={urls[0]}
            muted
            playsInline
            preload="metadata"
          />
        </div>
        <div>
          <div className="compare-label">
            处理成片 <span>声音开启</span>
          </div>
          <video
            ref={output}
            src={urls[1]}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              seek(0);
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setPosition(time);
              if (
                original.current &&
                Math.abs(original.current.currentTime - time - offset) > 0.18
              )
                original.current.currentTime = time + offset;
            }}
            onEnded={() => {
              original.current?.pause();
              setPlaying(false);
            }}
          />
        </div>
      </div>
      <div className="compare-controls">
        <Button
          type="primary"
          disabled={!duration}
          aria-label={playing ? "暂停" : "同步播放"}
          onClick={toggle}
          icon={playing ? <PauseOutlined /> : <PlayCircleOutlined />}
        >
          {playing ? "暂停" : "同步播放"}
        </Button>
        <Slider
          aria-label="对比视频进度"
          min={0}
          max={duration || 1}
          step={0.05}
          value={position}
          onChange={seek}
        />
        <span>
          {position.toFixed(1)} / {duration.toFixed(1)} 秒
        </span>
        <Button
          onClick={() => {
            original.current?.pause();
            output.current?.pause();
            setPlaying(false);
            seek(0);
          }}
        >
          回到开头
        </Button>
      </div>
      <p className="muted">
        两个视频同步播放与定位，默认播放成片声音。
        {offset > 0 ? `原片已偏移 ${offset} 秒以匹配裁切后的画面。` : ""}
      </p>
    </Modal>
  );
}
export function ReportModal({
  job,
  onClose,
}: {
  job: Job | null;
  onClose: () => void;
}) {
  const [report, setReport] = useState<Json | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setReport(null);
    setError("");
    if (!job) return;
    let active = true;
    void call<Json>("report.read", { id: job.id })
      .then((next) => {
        if (active) setReport(next);
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
    };
  }, [job?.id]);
  return (
    <Modal
      open={Boolean(job)}
      onCancel={onClose}
      width={940}
      footer={<Button onClick={onClose}>关闭报告</Button>}
      title={`质量报告 · ${job?.name || ""}`}
      destroyOnHidden
    >
      {error ? (
        <Empty description={error} />
      ) : (
        <>
          <div className="report-banner">
            <CheckCircleOutlined />
            <div>
              <strong>
                {job?.status === "success" ? "处理已完成" : "处理结果需要检查"}
              </strong>
              <p>
                展示实际测量结果；未测量项目会明确标注，不代表外部平台的审核结果。
              </p>
            </div>
            <Tag>{job ? kindLabel(job.kind) : ""}</Tag>
          </div>
          <Table
            loading={!report}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            size="small"
            rowKey="key"
            dataSource={report ? reportRows(report) : []}
            columns={[
              { title: "类别", dataIndex: "group", width: 150 },
              { title: "检查项目", dataIndex: "label", width: 230 },
              {
                title: "结果",
                dataIndex: "value",
                render: (value: string) => (
                  <Typography.Text className="report-cell">
                    {value}
                  </Typography.Text>
                ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
