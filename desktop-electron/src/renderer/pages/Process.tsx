import { useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { call, useStore } from "../store";
import { useDraft } from "../useDraft";
import {
  FileField,
  JobActions,
  JobProgress,
  PageTitle,
  Video,
} from "../components";
import type { Job, Json, Method } from "../types";
import { terminal } from "../types";

export function NativeFields({
  value,
  onChange,
}: {
  value: Json;
  onChange: (value: Json) => void;
}) {
  const { data } = useStore();
  const field = (key: string, next: unknown) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="form-grid">
      <Form.Item label="处理配置">
        <Select
          value={
            value.profile || data.profiles.find((p) => p.name === "soft")?.id
          }
          options={data.profiles.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(next) => field("profile", next)}
        />
      </Form.Item>
      <Form.Item label="视频编码器">
        <Select
          value={value.encoder || ""}
          onChange={(next) => field("encoder", next)}
          options={[
            { value: "", label: "自动选择" },
            { value: "libx264", label: "H.264（CPU）" },
            { value: "h264_videotoolbox", label: "H.264（Apple 硬件）" },
            { value: "h264_nvenc", label: "H.264（NVIDIA）" },
          ]}
        />
      </Form.Item>
      <Form.Item label="并行片段数">
        <InputNumber
          min={1}
          max={8}
          value={value.workers || 1}
          onChange={(next) => field("workers", next)}
        />
      </Form.Item>
      <Form.Item label="分段时长（秒）">
        <InputNumber
          min={1}
          max={7200}
          value={value.segment_sec || 600}
          onChange={(next) => field("segment_sec", next)}
        />
      </Form.Item>
      <Form.Item label="快速质量报告">
        <Switch
          checked={value.fast_qa !== false}
          onChange={(next) => field("fast_qa", next)}
        />
        <p className="field-help">
          快速模式抽样检查；关闭后增加 SSIM / VMAF 测量。
        </p>
      </Form.Item>
      <Form.Item label="生成新版本">
        <Switch
          checked={Boolean(value.new_variant)}
          onChange={(next) => field("new_variant", next)}
        />
      </Form.Item>
    </div>
  );
}

export function ReelsFields({
  rules,
  onChange,
}: {
  rules: Json;
  onChange: (rules: Json) => void;
}) {
  const set = (section: string, key: string, value: unknown) =>
    onChange({ ...rules, [section]: { ...rules[section], [key]: value } });
  return (
    <Form layout="vertical">
      <div className="form-grid">
        <Form.Item label="输出分辨率">
          <Select
            value={rules.video.width}
            onChange={(width) =>
              onChange({
                ...rules,
                video: {
                  ...rules.video,
                  width,
                  height: width === 1080 ? 1920 : 1280,
                },
              })
            }
            options={[
              { value: 1080, label: "1080 × 1920 · 全高清" },
              { value: 720, label: "720 × 1280 · 高清" },
            ]}
          />
        </Form.Item>
        <Form.Item label="横屏素材适配">
          <Select
            value={rules.video.geometry.nonvertical_source}
            onChange={(value) =>
              set("video", "geometry", {
                ...rules.video.geometry,
                nonvertical_source: value,
                allow_center_crop: value === "crop",
              })
            }
            options={[
              { value: "pad_blur", label: "模糊背景填充（保留画面）" },
              { value: "fit", label: "等比留边" },
              { value: "crop", label: "居中裁切（会裁掉边缘）" },
            ]}
          />
        </Form.Item>
        <Form.Item label="画面质量 CRF">
          <InputNumber
            min={18}
            max={23}
            value={rules.video.crf}
            onChange={(value) => set("video", "crf", value)}
          />
          <p className="field-help">数值越低，质量和文件体积越高。</p>
        </Form.Item>
        <Form.Item label="帧率">
          <Select
            value={rules.video.fps_mode}
            onChange={(value) => set("video", "fps_mode", value)}
            options={[
              { value: "auto", label: "跟随原始素材" },
              { value: "cfr30", label: "恒定 30 fps" },
            ]}
          />
        </Form.Item>
        <Form.Item label="片头裁切（秒）">
          <InputNumber
            min={0}
            value={rules.scenes.trim_start_sec}
            onChange={(value) => set("scenes", "trim_start_sec", value ?? 0)}
          />
        </Form.Item>
        <Form.Item label="片尾裁切（秒）">
          <InputNumber
            min={0}
            value={rules.scenes.trim_end_sec}
            onChange={(value) => set("scenes", "trim_end_sec", value ?? 0)}
          />
        </Form.Item>
      </div>
      <Collapse
        ghost
        items={[
          {
            key: "advanced",
            label: "音频与画面检查",
            children: (
              <div className="form-grid">
                <Form.Item label="响度标准化">
                  <Switch
                    checked={rules.audio.loudnorm.enabled}
                    onChange={(value) =>
                      set("audio", "loudnorm", {
                        ...rules.audio.loudnorm,
                        enabled: value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="目标响度 LUFS">
                  <InputNumber
                    min={-30}
                    max={-10}
                    value={rules.audio.loudnorm.integrated_lufs}
                    onChange={(value) =>
                      set("audio", "loudnorm", {
                        ...rules.audio.loudnorm,
                        integrated_lufs: value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="镜头检测">
                  <Switch
                    checked={rules.scenes.detect_enabled}
                    onChange={(value) => set("scenes", "detect_enabled", value)}
                  />
                </Form.Item>
                <Form.Item label="HDR 素材策略">
                  <Select
                    value={rules.video.hdr_policy}
                    onChange={(value) => set("video", "hdr_policy", value)}
                    options={[
                      { value: "fail_with_advice", label: "提示后停止" },
                      { value: "tonemap_sdr", label: "转换为 SDR" },
                    ]}
                  />
                </Form.Item>
              </div>
            ),
          },
        ]}
      />
    </Form>
  );
}

export function PackagingFields({
  rules,
  assets,
  onChange,
  onAssets,
}: {
  rules: Json;
  assets: Record<string, string>;
  onChange: (value: Json) => void;
  onAssets: (value: Record<string, string>) => void;
}) {
  const { message } = App.useApp();
  const packaging = rules.packaging;
  const set = (key: string, value: unknown) =>
    onChange({ ...rules, packaging: { ...packaging, [key]: value } });
  const pick = async (kind: "font" | "image") => {
    try {
      const [path] = await window.electronAPI.pick(kind);
      if (!path) return;
      const name =
        kind === "font"
          ? `title-font.${path.split(".").pop()}`
          : `logo.${path.split(".").pop()}`;
      onAssets({ ...assets, [name]: path });
      if (kind === "font")
        set("title", { ...packaging.title, font_path: name });
      else set("logo", { ...packaging.logo, source: name });
    } catch (failure) {
      message.error(String(failure));
    }
  };
  return (
    <Form layout="vertical">
      <Form.Item label="启用画面包装">
        <Switch
          checked={packaging.enabled}
          onChange={(enabled) =>
            onChange({
              ...rules,
              packaging: {
                ...packaging,
                enabled,
                title: {
                  ...packaging.title,
                  enabled: enabled && packaging.title.enabled,
                },
                logo: {
                  ...packaging.logo,
                  enabled: enabled && packaging.logo.enabled,
                },
              },
            })
          }
        />
        <p className="field-help">
          按需添加自有标志和人工标题，不移除原素材水印。
        </p>
      </Form.Item>
      <div className="form-grid">
        <Form.Item label="显示标志">
          <Switch
            disabled={!packaging.enabled}
            checked={packaging.logo.enabled}
            onChange={(enabled) => set("logo", { ...packaging.logo, enabled })}
          />
        </Form.Item>
        <Form.Item label="标志图片">
          <Button disabled={!packaging.enabled} onClick={() => pick("image")}>
            {packaging.logo.source || "选择图片"}
          </Button>
        </Form.Item>
        <Form.Item label="标志位置">
          <Select
            disabled={!packaging.enabled}
            value={packaging.logo.anchor}
            onChange={(anchor) => set("logo", { ...packaging.logo, anchor })}
            options={[
              "top_right",
              "top_left",
              "bottom_right",
              "bottom_left",
            ].map((value, i) => ({
              value,
              label: ["右上", "左上", "右下", "左下"][i],
            }))}
          />
        </Form.Item>
        <Form.Item label="标志宽度（像素）">
          <InputNumber
            min={8}
            max={1080}
            value={packaging.logo.width_px}
            onChange={(width_px) =>
              set("logo", { ...packaging.logo, width_px })
            }
          />
        </Form.Item>
        <Form.Item label="显示标题">
          <Switch
            disabled={!packaging.enabled}
            checked={packaging.title.enabled}
            onChange={(enabled) =>
              set("title", { ...packaging.title, enabled })
            }
          />
        </Form.Item>
        <Form.Item label="标题字体">
          <Button disabled={!packaging.enabled} onClick={() => pick("font")}>
            {packaging.title.font_path || "选择本地字体（中文需支持中文字形）"}
          </Button>
        </Form.Item>
        <Form.Item label="标题文字" className="col-span-2">
          <Input.TextArea
            disabled={!packaging.enabled}
            maxLength={500}
            value={packaging.title.text || ""}
            onChange={(event) =>
              set("title", { ...packaging.title, text: event.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="标题位置">
          <Select
            value={packaging.title.position}
            onChange={(position) =>
              set("title", { ...packaging.title, position })
            }
            options={[
              { value: "top_safe", label: "顶部安全区" },
              { value: "center_safe", label: "居中安全区" },
              { value: "bottom_safe", label: "底部安全区" },
            ]}
          />
        </Form.Item>
        <Form.Item label="保护原有硬字幕">
          <Switch
            checked={packaging.protect_existing_hard_subtitles}
            onChange={(next) => set("protect_existing_hard_subtitles", next)}
          />
        </Form.Item>
      </div>
    </Form>
  );
}

export default function ProcessPage({
  deliveryOnly,
  compare,
  report,
}: {
  deliveryOnly?: boolean;
  compare: (job: Job) => void;
  report: (job: Job) => void;
}) {
  const { data, jobs, settings, submit } = useStore();
  const { message } = App.useApp();
  const scope = deliveryOnly ? "delivery" : "process";
  const [source, setSource] = useDraft(`${scope}:source`, "");
  const [output, setOutput] = useDraft(`${scope}:output`, "");
  const [method, setMethod] = useDraft<Method>(
    `${scope}:method`,
    deliveryOnly ? "reels" : settings.method,
  );
  const [rules, setRules] = useDraft<Json>(`${scope}:rules`, () =>
    structuredClone(data.rules),
  );
  const [assets, setAssets] = useDraft<Record<string, string>>(
    `${scope}:assets`,
    {},
  );
  const [native, setNative] = useDraft<Json>(`${scope}:native`, {
    fast_qa: true,
  });
  const [step, setStep] = useDraft(`${scope}:step`, 0);
  const [sampleDuration, setSampleDuration] = useState(10);
  const [sampleStart, setSampleStart] = useState(0);
  const [jobId, setJobId] = useDraft(`${scope}:job`, "");
  const [pending, setPending] = useState(false);
  const [meta, setMeta] = useState<Json | null>(null);
  const job = jobs.find((item) => item.id === jobId);
  const busy = pending || Boolean(job && !terminal(job));
  useEffect(() => {
    let current = true;
    setMeta(null);
    if (source)
      void call<Json>("probe", { path: source })
        .then((next) => {
          if (current) setMeta(next);
        })
        .catch((failure) => message.error(String(failure)));
    return () => {
      current = false;
    };
  }, [source]);
  const start = async (mode: string) => {
    setPending(true);
    try {
      const created = await submit({
        source,
        output_dir: output || undefined,
        kind: method,
        mode,
        rules,
        assets,
        ...native,
        sample_duration: sampleDuration,
        sample_start: sampleStart,
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
        title={deliveryOnly ? "短剧制作" : "视频处理"}
        detail="从原始素材到交付成片。先检查、试做样片，再完整导出。"
        extra={<Tag icon={<SafetyOutlined />}>仅用于自有或已授权素材</Tag>}
      />
      {!deliveryOnly && (
        <div className="method-row">
          <span>处理方式</span>
          <Segmented
            value={method}
            onChange={(value) => setMethod(value as Method)}
            options={[
              { value: "reels", label: "短剧交付 · 默认" },
              { value: "native", label: "通用视频处理" },
            ]}
          />
        </div>
      )}
      <div className="process-layout">
        <div className="process-workspace">
          <div className="process-steps">
            <Steps
              current={step}
              onChange={setStep}
              size="small"
              items={[
                { title: "导入素材" },
                { title: "处理参数" },
                { title: method === "reels" ? "画面包装" : "试做样片" },
                { title: "检查与导出" },
              ]}
            />
          </div>
          <Card className="step-card" bordered={false}>
            {step === 0 && (
              <>
                <div className="section-label">01 / 素材与存储</div>
                <h2>选择要处理的视频</h2>
                <FileField
                  label="输入素材"
                  path={source}
                  onChange={setSource}
                />
                <FileField
                  label="输出文件夹"
                  path={output}
                  onChange={setOutput}
                  directory
                />
                <Alert
                  type="info"
                  showIcon
                  message="结果使用独立目录或唯一文件名保存，原始素材不会被覆盖。"
                />
                {meta && (
                  <div className="meta-grid">
                    <div>
                      <small>素材时长</small>
                      <strong>{Number(meta.duration_sec).toFixed(1)} 秒</strong>
                    </div>
                    <div>
                      <small>视频分辨率</small>
                      <strong>
                        {meta.video?.[0]?.width} × {meta.video?.[0]?.height}
                      </strong>
                    </div>
                    <div>
                      <small>音频</small>
                      <strong>
                        {meta.audio?.length ? "包含音轨" : "无音轨"}
                      </strong>
                    </div>
                  </div>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <div className="section-label">02 / 处理参数</div>
                <h2>设置画面与声音</h2>
                {method === "reels" ? (
                  <ReelsFields rules={rules} onChange={setRules} />
                ) : (
                  <Form layout="vertical">
                    <NativeFields value={native} onChange={setNative} />
                  </Form>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <div className="section-label">
                  03 / {method === "reels" ? "画面包装" : "样片"}
                </div>
                <h2>
                  {method === "reels"
                    ? "添加自有标志与标题"
                    : "先试做一个短片段"}
                </h2>
                {method === "reels" ? (
                  <PackagingFields
                    rules={rules}
                    onChange={setRules}
                    assets={assets}
                    onAssets={setAssets}
                  />
                ) : (
                  <Form layout="vertical">
                    <div className="form-grid">
                      <Form.Item label="样片起点（秒）">
                        <InputNumber
                          min={0}
                          value={sampleStart}
                          onChange={(value) => setSampleStart(value || 0)}
                        />
                      </Form.Item>
                      <Form.Item label="样片时长（秒）">
                        <InputNumber
                          min={1}
                          max={180}
                          value={sampleDuration}
                          onChange={(value) => setSampleDuration(value || 10)}
                        />
                      </Form.Item>
                    </div>
                    <Button
                      disabled={!source || busy}
                      icon={<PlayCircleOutlined />}
                      onClick={() => start("sample")}
                    >
                      处理样片
                    </Button>
                  </Form>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <div className="section-label">04 / 交付检查</div>
                <h2>确认配置，开始交付</h2>
                <div className="delivery-summary">
                  <div>
                    <small>处理方式</small>
                    <strong>
                      {method === "reels" ? "短剧视频交付" : "通用视频处理"}
                    </strong>
                  </div>
                  <div>
                    <small>输入视频</small>
                    <strong>{source.split(/[\\/]/).pop() || "尚未选择"}</strong>
                  </div>
                  <div>
                    <small>画面</small>
                    <strong>
                      {method === "reels"
                        ? `${rules.video.width} × ${rules.video.height} / H.264`
                        : "跟随处理配置"}
                    </strong>
                  </div>
                  <div>
                    <small>成片报告</small>
                    <strong>自动生成</strong>
                  </div>
                </div>
                <Alert
                  showIcon
                  type="info"
                  message="建议先处理 10 秒样片，确认画面、字幕和声音，再导出完整成片。"
                />
                <Space className="mt-5" wrap>
                  <Button
                    disabled={!source || busy}
                    onClick={() => start("preflight")}
                    icon={<SafetyOutlined />}
                  >
                    检查视频
                  </Button>
                  <Button
                    disabled={!source || busy}
                    onClick={() => start("sample")}
                    icon={<PlayCircleOutlined />}
                  >
                    试做 {sampleDuration} 秒样片
                  </Button>
                  <Button
                    type="primary"
                    loading={pending}
                    disabled={!source || busy}
                    onClick={() => start("export")}
                    icon={<ArrowRightOutlined />}
                  >
                    完整导出
                  </Button>
                </Space>
              </>
            )}
            <div className="step-navigation">
              <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
                上一步
              </Button>
              {step < 3 && (
                <Button type="primary" onClick={() => setStep(step + 1)}>
                  下一步 <ArrowRightOutlined />
                </Button>
              )}
            </div>
          </Card>
          <JobProgress job={job} />
          {job?.status === "success" && job.output && (
            <div className="result-bar">
              <CheckCircleOutlined />
              <div>
                <strong>
                  {job.mode === "sample" ? "样片已完成" : "成片已完成"}
                </strong>
                <small>可同步对比原片与成片，并查看质量报告</small>
              </div>
              <JobActions job={job} compare={compare} report={report} />
            </div>
          )}
        </div>
        <aside className="preview-panel">
          <div className="preview-title">
            <strong>素材预览</strong>
            <Tag>本地</Tag>
          </div>
          <Video path={source} />
          <div className="preview-info">
            <span>当前流程</span>
            <strong>{method === "reels" ? "短剧交付" : "通用处理"}</strong>
            <p>处理任务在后台运行，切换页面不影响任务进度。</p>
          </div>
        </aside>
      </div>
    </>
  );
}
