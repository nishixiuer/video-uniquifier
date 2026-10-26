import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import {
  productionLabels,
  type ProductionBatch,
  type ProductionInput,
} from "../../shared/production";
import { PageTitle } from "../components";
import type { Job } from "../types";
import { useStore } from "../store";
import { useDraft } from "../useDraft";
import { invoke, PublishingLoading, usePublishing } from "./publishing-state";

type Callbacks = { compare: (job: Job) => void; report: (job: Job) => void };
export default function Production({ compare, report }: Callbacks) {
  const { data, error, run } = usePublishing();
  const { jobs } = useStore();
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [draft, setDraft] = useDraft<Partial<ProductionInput>>(
    "production:form",
    {},
  );
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<
    { material: { name: string }; start: number; end: number }[] | null
  >(null);
  const [detail, setDetail] = useState<string | null>(params.get("batch"));
  if (!data) return <PublishingLoading error={error} />;
  const initialIds = params.get("materials")?.split(",").filter(Boolean);
  const eligible = data.materials.filter(
    (material) => material.active && material.description,
  );
  const values = async (): Promise<ProductionInput> => {
    const input = await form.validateFields();
    return {
      ...input,
      rules: {
        video: {
          width: input.width,
          height: input.width === 720 ? 1280 : 1920,
          crf: input.crf,
        },
        scenes: { detect_enabled: input.detect },
      },
    };
  };
  const selectedBatch = data.batches.find((batch) => batch.id === detail);
  const totals = data.batches.flatMap((batch) => batch.items);
  const act = (batch: ProductionBatch, action: string, itemId?: string) => {
    void run(
      "production.action",
      { id: batch.id, action, itemId },
      action === "retry" ? "失败项已重新排队" : "批次已更新",
    ).catch(() => {});
  };
  return (
    <>
      <PageTitle
        title="批量制作"
        detail="先确认剪片区间，再自动制作视频与推广文案。成功结果进入内容库，失败项可以单独重试。"
        extra={<Link to="/library/materials">管理源视频与资料 →</Link>}
      />
      <div className="workflow-guide">
        <Link to="/library/materials">01 素材与资料</Link>
        <span className="is-current">02 批量制作</span>
        <Link to="/publishing/posts">03 内容审核</Link>
        <Link to="/publishing/pages">04 规则发布</Link>
      </div>
      <div className="production-layout">
        <Card title="新建制作批次" bordered={false}>
          {!eligible.length && (
            <Alert
              type="info"
              showIcon
              message={
                <span>
                  请先在<Link to="/library/materials">素材库</Link>
                  导入视频并完善资料。
                </span>
              }
              className="mb-5"
            />
          )}
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              name: "",
              start: 0,
              clipSeconds: 30,
              clipsPerMaterial: 1,
              strategy: "sequential",
              language: "简体中文",
              mode: "ai",
              templateId: "default",
              review: "pending",
              tags: [],
              width: 720,
              crf: 21,
              detect: true,
              ...draft,
              ...(initialIds ? { materialIds: initialIds } : {}),
            }}
            onValuesChange={(_, all) => setDraft(all)}
          >
            <Form.Item name="name" label="批次名称">
              <Input placeholder="例如：都市短剧 · 第一批" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="materialIds"
              label="来源素材"
              rules={[{ required: true, message: "请选择素材" }]}
            >
              <Select
                mode="multiple"
                placeholder="选择已完善资料的视频"
                options={eligible.map((m) => ({
                  value: m.id,
                  label: `${m.name} · ${m.duration.toFixed(1)} 秒`,
                }))}
              />
            </Form.Item>
            <div className="form-grid">
              <Form.Item
                name="clipSeconds"
                label="每段时长（秒）"
                rules={[{ required: true }]}
              >
                <InputNumber min={0.1} max={3600} />
              </Form.Item>
              <Form.Item
                name="clipsPerMaterial"
                label="每个视频制作条数"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={50} precision={0} />
              </Form.Item>
              <Form.Item
                name="start"
                label="从第几秒开始"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} max={86400} />
              </Form.Item>
              <Form.Item name="strategy" label="选段方式">
                <Select
                  options={[
                    { value: "sequential", label: "从起点连续分段" },
                    { value: "spread", label: "在可用时长内均匀选段" },
                  ]}
                />
              </Form.Item>
            </div>
            <p className="muted">
              片段不重叠。仅制作一条且源视频较短时使用剩余完整时长。可先预览计划，确认每条内容的来源区间。
            </p>
            <div className="form-grid">
              <Form.Item name="width" label="竖屏输出">
                <Select
                  options={[
                    { value: 720, label: "720 × 1280" },
                    { value: 1080, label: "1080 × 1920" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="crf" label="画质">
                <Select
                  options={[
                    { value: 18, label: "高画质 · 文件较大" },
                    { value: 21, label: "均衡（推荐）" },
                    { value: 23, label: "小体积" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="detect" label="镜头分析" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="language" label="推广文案语种">
                <Select
                  options={["简体中文", "繁体中文", "英语", "日语", "韩语"].map(
                    (value) => ({ value, label: value }),
                  )}
                />
              </Form.Item>
            </div>
            <Form.Item name="templateId" label="推广文案提示词">
              <Select
                options={data.templates.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            </Form.Item>
            <p className="muted">
              <Link to="/settings/services#templates">管理提示词与模板 →</Link>
            </p>
            <Form.Item name="mode" label="文案生成方式">
              <Select
                options={[
                  { value: "ai", label: "AI 根据本条视频资料生成" },
                  { value: "template", label: "本地模板（离线）" },
                ]}
              />
            </Form.Item>
            {!data.ai.model && (
              <p className="muted">
                AI 接口尚未配置。
                <Link to="/settings/services">前往服务配置 →</Link>
              </p>
            )}
            <Form.Item name="tags" label="追加内容标签">
              <Select
                mode="tags"
                tokenSeparators={[",", "，"]}
                placeholder="素材分类和标签会自动继承"
              />
            </Form.Item>
            <Form.Item name="review" label="入库审核状态">
              <Select
                options={[
                  { value: "pending", label: "待审核（推荐）" },
                  {
                    value: "approved",
                    label: "直接标记已审核，可参与自动发布",
                  },
                ]}
              />
            </Form.Item>
            <Space wrap>
              <Button
                disabled={busy}
                onClick={async () => {
                  try {
                    setPlan(await invoke("production.preview", await values()));
                  } catch (error) {
                    if (error instanceof Error) message.error(error.message);
                  }
                }}
              >
                预览剪片计划
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={async () => {
                  try {
                    const input = await values();
                    setBusy(true);
                    const batch = await invoke<ProductionBatch>(
                      "production.create",
                      input,
                    );
                    setDetail(batch.id);
                    await run("snapshot", {}, "批次已创建，可切换页面等待制作");
                  } catch (error) {
                    if (error instanceof Error) message.error(error.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                开始批量制作
              </Button>
            </Space>
          </Form>
        </Card>
        <div>
          <div className="production-counts">
            <div>
              <strong>
                {
                  totals.filter((i) =>
                    ["queued", "video", "copy"].includes(i.status),
                  ).length
                }
              </strong>
              <span>等待 / 制作中</span>
            </div>
            <div>
              <strong>
                {totals.filter((i) => i.status === "succeeded").length}
              </strong>
              <span>已入内容库</span>
            </div>
            <div>
              <strong>
                {totals.filter((i) => i.status === "failed").length}
              </strong>
              <span>失败待处理</span>
            </div>
          </div>
          <Card title="制作记录" bordered={false}>
            <Table
              rowKey="id"
              pagination={{ pageSize: 6 }}
              dataSource={data.batches}
              columns={[
                {
                  title: "批次 / 进度",
                  render: (_, batch) => {
                    const done = batch.items.filter((i) =>
                      ["succeeded", "failed", "cancelled"].includes(i.status),
                    ).length;
                    return (
                      <>
                        <strong>{batch.name}</strong>
                        <p className="muted">
                          {new Date(batch.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {batch.items.length} 条
                        </p>
                        <Progress
                          percent={Math.round(
                            (done / batch.items.length) * 100,
                          )}
                          size="small"
                        />
                        <Space wrap>
                          {batch.paused && <Tag>已暂停</Tag>}
                          <Tag color="success">
                            {
                              batch.items.filter(
                                (i) => i.status === "succeeded",
                              ).length
                            }{" "}
                            成功
                          </Tag>
                          <Tag
                            color={
                              batch.items.some((i) => i.status === "failed")
                                ? "error"
                                : "default"
                            }
                          >
                            {
                              batch.items.filter((i) => i.status === "failed")
                                .length
                            }{" "}
                            失败
                          </Tag>
                        </Space>
                      </>
                    );
                  },
                },
                {
                  title: "操作",
                  width: 155,
                  render: (_, batch) => (
                    <Space wrap>
                      <Button size="small" onClick={() => setDetail(batch.id)}>
                        查看详情
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          act(batch, batch.paused ? "resume" : "pause")
                        }
                      >
                        {batch.paused ? "继续" : "暂停"}
                      </Button>
                      <Button
                        size="small"
                        disabled={
                          !batch.items.some((i) => i.status === "failed")
                        }
                        onClick={() => act(batch, "retry")}
                      >
                        重试失败项
                      </Button>
                      <Button
                        size="small"
                        danger
                        disabled={
                          !batch.items.some((i) =>
                            ["queued", "video", "copy"].includes(i.status),
                          )
                        }
                        onClick={() => act(batch, "cancel")}
                      >
                        取消待完成项
                      </Button>
                    </Space>
                  ),
                },
              ]}
              locale={{
                emptyText: "还没有制作批次。从左侧选择素材并创建计划。",
              }}
            />
          </Card>
          <p className="muted mt-4">
            制作和发布分开执行。暂停批次后不会启动下一项，已提交的视频编码会继续；关闭应用后保留记录，重开继续检查，编码中断的项目可重试。
          </p>
        </div>
      </div>
      <Modal
        title="剪片计划"
        width={780}
        open={Boolean(plan)}
        onCancel={() => setPlan(null)}
        footer={<Button onClick={() => setPlan(null)}>返回制作设置</Button>}
      >
        <Table
          rowKey={(_, index) => String(index)}
          dataSource={plan || []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "源视频", render: (_, row) => row.material.name },
            {
              title: "开始 / 结束",
              render: (_, row) => `${row.start}–${row.end} 秒`,
            },
            {
              title: "成片时长",
              render: (_, row) => `${(row.end - row.start).toFixed(2)} 秒`,
            },
          ]}
        />
      </Modal>
      <Modal
        title={`制作详情 · ${selectedBatch?.name || ""}`}
        width={1060}
        open={Boolean(selectedBatch)}
        onCancel={() => setDetail(null)}
        footer={
          <Link to="/publishing/posts" onClick={() => setDetail(null)}>
            前往内容库审核 →
          </Link>
        }
      >
        {selectedBatch && (
          <>
            <p className="muted">
              {selectedBatch.template.name} ·{" "}
              {selectedBatch.mode === "ai"
                ? selectedBatch.ai.model
                : "本地模板"}{" "}
              · {selectedBatch.language}。使用创建时的资料和配置快照。
            </p>
            <Table
              rowKey="id"
              scroll={{ x: 900 }}
              dataSource={selectedBatch.items}
              pagination={{ pageSize: 8 }}
              columns={[
                {
                  title: "来源 / 区间",
                  render: (_, item) => (
                    <>
                      <strong>{item.material.name}</strong>
                      <p>
                        {item.start}–{item.end} 秒
                      </p>
                    </>
                  ),
                },
                {
                  title: "阶段",
                  width: 180,
                  render: (_, item) => (
                    <>
                      <Tag
                        color={
                          item.status === "failed"
                            ? "error"
                            : item.status === "succeeded"
                              ? "success"
                              : "default"
                        }
                      >
                        {productionLabels[item.status]}
                      </Tag>
                      <Progress
                        percent={item.progress}
                        size="small"
                        status={
                          item.status === "failed" ? "exception" : undefined
                        }
                      />
                    </>
                  ),
                },
                {
                  title: "说明",
                  render: (_, item) => (
                    <span className={item.error ? "error-copy" : "muted"}>
                      {item.error ||
                        (item.postId
                          ? "视频与文案已入库"
                          : item.output
                            ? "成片已保存，文案重试将复用成片"
                            : "按规则自动制作视频")}
                    </span>
                  ),
                },
                {
                  title: "操作",
                  width: 225,
                  render: (_, item) => {
                    const job = jobs.find((j) => j.id === item.jobId);
                    return (
                      <Space wrap>
                        <Button
                          size="small"
                          disabled={item.status !== "failed"}
                          onClick={() => act(selectedBatch, "retry", item.id)}
                        >
                          重试
                        </Button>
                        <Button
                          size="small"
                          disabled={!job?.output}
                          onClick={() => job && compare(job)}
                        >
                          视频对比
                        </Button>
                        <Button
                          size="small"
                          disabled={!job?.report}
                          onClick={() => job && report(job)}
                        >
                          质量报告
                        </Button>
                      </Space>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
