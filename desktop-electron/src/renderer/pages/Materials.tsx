import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { FolderAddOutlined, PlayCircleOutlined } from "@ant-design/icons";
import type { Material } from "../../shared/production";
import { PageTitle, Video } from "../components";
import { invoke, PublishingLoading, usePublishing } from "./publishing-state";

export default function Materials() {
  const { data, error, run, refresh } = usePublishing();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Material | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [form] = Form.useForm();
  if (!data) return <PublishingLoading error={error} />;
  const create = (ids: string[]) =>
    navigate(
      `/workspace/production?materials=${encodeURIComponent(ids.join(","))}`,
    );
  const importVideos = async () => {
    try {
      const paths = await window.electronAPI.pick("video", true);
      if (!paths.length) return;
      setBusy(true);
      const result = await invoke<{ added: Material[]; errors: string[] }>(
        "materials.import",
        { paths },
      );
      await refresh();
      setFailures(result.errors);
      if (result.added.length) {
        message.success(`已导入 ${result.added.length} 个视频，请完善视频资料`);
        if (result.added.length === 1) {
          setEditing(result.added[0]);
          form.setFieldsValue(result.added[0]);
        }
      }
    } catch (error) {
      message.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const records = data.materials.filter(
    (material) =>
      `${material.name} ${material.description} ${material.tags.join(" ")} ${material.category}`.includes(
        query,
      ) &&
      (status === "all" ||
        (status === "active"
          ? material.active
          : status === "inactive"
            ? !material.active
            : !material.description)),
  );
  return (
    <>
      <PageTitle
        title="素材库"
        detail="先保存源视频与剧情 / 推广资料，再批量制作成片和文案。所有文件保存在本机。"
        extra={
          <Button
            type="primary"
            icon={<FolderAddOutlined aria-hidden="true" />}
            loading={busy}
            onClick={() => {
              void importVideos();
            }}
          >
            导入视频
          </Button>
        }
      />
      <div className="workflow-guide">
        <span className="is-current">01 素材与资料</span>
        <span>02 批量制作</span>
        <span>03 内容审核</span>
        <span>04 规则发布</span>
      </div>
      <div className="summary-strip">
        <div>
          <small>源视频</small>
          <strong>{data.materials.length}</strong>
        </div>
        <div>
          <small>待完善资料</small>
          <strong>{data.materials.filter((m) => !m.description).length}</strong>
        </div>
        <div>
          <small>已制作内容</small>
          <strong>{data.posts.filter((p) => p.source).length}</strong>
        </div>
      </div>
      <Card bordered={false}>
        <div className="table-toolbar">
          <Input
            value={query}
            aria-label="搜索素材"
            placeholder="搜索名称、剧情、分类或标签"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            aria-label="素材状态"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "全部素材" },
              { value: "active", label: "已启用" },
              { value: "incomplete", label: "待完善资料" },
              { value: "inactive", label: "已停用" },
            ]}
          />
          <Button
            type="primary"
            disabled={!selected.length}
            onClick={() => create(selected.map(String))}
          >
            批量制作（{selected.length}）
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={records}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 850 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (material) => ({
              disabled: !material.active || !material.description,
            }),
          }}
          columns={[
            {
              title: "视频素材",
              render: (_, material) => (
                <div>
                  <strong>{material.name}</strong>
                  <p className="post-copy-excerpt">
                    {material.description || "尚未填写剧情介绍 / 推广资料"}
                  </p>
                  <Space wrap>
                    {material.category && <Tag>{material.category}</Tag>}
                    {material.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                </div>
              ),
            },
            {
              title: "视频信息",
              width: 150,
              render: (_, material) => (
                <span>
                  {material.duration.toFixed(1)} 秒<br />
                  {material.width} × {material.height}
                  <br />
                  <small className="muted">
                    {(material.video.size / 1024 / 1024).toFixed(1)} MB
                  </small>
                </span>
              ),
            },
            {
              title: "状态 / 成品",
              width: 140,
              render: (_, material) => (
                <>
                  <Tag
                    color={
                      !material.active
                        ? "default"
                        : material.description
                          ? "success"
                          : "warning"
                    }
                  >
                    {!material.active
                      ? "已停用"
                      : material.description
                        ? "可制作"
                        : "待完善资料"}
                  </Tag>
                  <p>
                    {
                      data.posts.filter(
                        (p) => p.source?.materialId === material.id,
                      ).length
                    }{" "}
                    条内容
                  </p>
                </>
              ),
            },
            {
              title: "操作",
              width: 260,
              render: (_, material) => (
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() => setPreview(material)}
                    icon={<PlayCircleOutlined aria-hidden="true" />}
                  >
                    预览
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(material);
                      form.setFieldsValue(material);
                    }}
                  >
                    编辑资料
                  </Button>
                  <Button
                    size="small"
                    disabled={!material.active || !material.description}
                    onClick={() => create([material.id])}
                  >
                    制作帖子
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      void run(
                        "material.save",
                        { ...material, active: !material.active },
                        material.active
                          ? "素材已停用，关联内容暂停选稿"
                          : "素材已启用",
                      ).catch(() => {});
                    }}
                  >
                    {material.active ? "停用" : "启用"}
                  </Button>
                  {!data.batches.some((batch) =>
                    batch.items.some(
                      (item) => item.material.id === material.id,
                    ),
                  ) && (
                    <Popconfirm
                      title="移除此素材记录？本地文件仍会保留。"
                      onConfirm={() =>
                        run("material.delete", { id: material.id })
                      }
                    >
                      <Button size="small" danger>
                        移除
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
          locale={{
            emptyText: (
              <Empty description="还没有源视频。导入后补充视频资料，即可开始批量制作。" />
            ),
          }}
        />
      </Card>
      <p className="muted mt-4">
        停用素材后，关联内容不再参与自动选稿；历史成片、文案和任务记录仍可查看。
        <Link to="/publishing/posts">前往内容库 →</Link>
      </p>
      <Modal
        title="视频资料"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        okText="保存资料"
        cancelText="取消"
        onOk={async () => {
          try {
            await run("material.save", {
              ...(await form.validateFields()),
              id: editing!.id,
            });
            setEditing(null);
          } catch {}
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="视频 / 短剧名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="description"
            label="剧情介绍 / 推广资料"
            rules={[{ required: true, message: "请填写供 AI 使用的视频资料" }]}
          >
            <Input.TextArea
              rows={7}
              maxLength={20000}
              showCount
              placeholder="剧情梗概、人物关系、卖点、推广链接或禁止出现的内容。AI 将按这份资料生成推广文案。"
            />
          </Form.Item>
          <Form.Item name="category" label="分类（自动加入内容标签）">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" tokenSeparators={[",", "，"]} />
          </Form.Item>
          <Form.Item name="active" label="启用素材" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={preview?.name || "源视频预览"}
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        footer={null}
        width={800}
        destroyOnHidden
      >
        {preview && <Video path={preview.video.path} />}
      </Modal>
      <Modal
        title="部分视频导入失败"
        open={failures.length > 0}
        onCancel={() => setFailures([])}
        footer={<Button onClick={() => setFailures([])}>关闭</Button>}
      >
        {failures.map((failure, index) => (
          <p key={index}>{failure}</p>
        ))}
      </Modal>
    </>
  );
}
