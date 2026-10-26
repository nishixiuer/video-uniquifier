import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  FacebookPage,
  GenerationInput,
  Media,
  Post,
} from "../../shared/publishing";
import { taskLabels } from "../../shared/publishing";
import { PageTitle, Video } from "../components";
import { useStore } from "../store";
import { useDraft } from "../useDraft";
import {
  invoke,
  usePublishing,
  PublishingLoading as Loading,
} from "./publishing-state";
const languages = ["简体中文", "繁体中文", "英语", "日语", "韩语"].map(
  (label) => ({ value: label, label }),
);

function MediaPreview({ media }: { media: Media[] }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    setImage("");
    if (media[0]?.kind === "image")
      void window.electronAPI
        .mediaUrl(media[0].path)
        .then((url) => {
          if (active) setImage(url);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [media[0]?.path]);
  return media[0]?.kind === "video" ? (
    <Video path={media[0].path} />
  ) : image ? (
    <img src={image} alt="帖子图片预览" className="post-preview-image" />
  ) : null;
}

export function PostsPage() {
  const { data, error, run, refresh } = usePublishing();
  const { jobs } = useStore();
  const { message } = App.useApp();
  const [editor, setEditor] = useState<Post | "new" | null>(null);
  const [form] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [media, setMedia] = useState<Media[]>([]);
  const [generationMedia, setGenerationMedia] = useDraft<Media[]>(
    "publishing:media",
    [],
  );
  const [generationDraft, setGenerationDraft] = useDraft<
    Partial<GenerationInput>
  >("publishing:generation", {});
  const [activeTab, setActiveTab] = useDraft("publishing:tab", "posts");
  const [busy, setBusy] = useState(false);
  const [generationResult, setGenerationResult] = useState<
    { id?: string; error?: string }[]
  >([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [template, setTemplate] = useState(false);
  const [templateForm] = Form.useForm();
  const [publish, setPublish] = useState<Post | null>(null);
  const [publishForm] = Form.useForm();
  const [preview, setPreview] = useState<Post | null>(null);
  const copy = Form.useWatch("copy", form);

  const chooseMedia = async (generation = false, path?: string) => {
    try {
      const paths = path
        ? [path]
        : await window.electronAPI.pick("post-media", true);
      if (!paths.length) return;
      const selected = await invoke<Media[]>("media.import", { paths });
      if (generation)
        setGenerationMedia((current) => [...current, ...selected]);
      else setMedia((current) => [...current, ...selected]);
    } catch (error) {
      message.error(String(error));
    }
  };
  const openEditor = (post?: Post) => {
    setEditor(post || "new");
    setMedia(post?.media || []);
    form.resetFields();
    form.setFieldsValue(
      post || {
        title: "",
        copy: "",
        language: "简体中文",
        tags: [],
        review: "pending",
      },
    );
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await run("post.save", {
        ...values,
        media,
        ...(editor && editor !== "new" ? { id: editor.id } : {}),
      });
      setEditor(null);
    } catch {
      /* Validation and service errors are shown in place. */
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    try {
      const values = await generateForm.validateFields();
      setBusy(true);
      setGenerationResult([]);
      const videos = generationMedia.filter((media) => media.kind === "video");
      const result = await invoke<{ id?: string; error?: string }[]>(
        "posts.generate",
        {
          ...values,
          tags: values.tags || [],
          media: generationMedia,
          quantity: videos.length || values.quantity,
        } as GenerationInput,
      );
      setGenerationResult(result);
      await refresh();
      message.info(
        `已生成 ${result.filter((row) => row.id).length} 条待审核帖子`,
      );
    } catch (error) {
      message.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <Loading error={error} />;
  const imported = (items: Media[], set: (items: Media[]) => void) => (
    <List
      size="small"
      dataSource={items}
      locale={{ emptyText: "尚未选择素材，可生成纯文字帖子" }}
      renderItem={(item) => (
        <List.Item
          actions={[
            <Button
              key="remove"
              type="text"
              size="small"
              onClick={() => set(items.filter((row) => row.id !== item.id))}
            >
              移除
            </Button>,
          ]}
        >
          <span>
            {item.kind === "video" ? "视频" : "图片"} · {item.name}
          </span>
        </List.Item>
      )}
    />
  );
  const submitPublish = async () => {
    try {
      const values = await publishForm.validateFields();
      await run(
        "task.create",
        {
          postId: publish!.id,
          pageId: values.pageId,
          format: values.format,
          scheduledAt: values.when
            ? new Date(values.when).getTime()
            : Date.now(),
        },
        "已创建发布任务，可在发布任务页面查看",
      );
      setPublish(null);
    } catch {
      /* Form and service show errors. */
    }
  };
  return (
    <>
      <PageTitle
        title="帖子内容"
        detail="从本地素材生成文案、审核内容，再安排 Facebook 主页发布。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openEditor()}
          >
            新建帖子
          </Button>
        }
      />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "posts",
            label: `内容库（${data.posts.length}）`,
            children: (
              <Card bordered={false}>
                <div className="table-toolbar">
                  <Input
                    placeholder="搜索标题或文案"
                    aria-label="搜索帖子"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Select
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: "all", label: "全部内容" },
                      { value: "pending", label: "待审核" },
                      { value: "approved", label: "已审核" },
                    ]}
                  />
                </div>
                <Table
                  rowKey="id"
                  pagination={{ pageSize: 8 }}
                  dataSource={data.posts.filter(
                    (post) =>
                      (filter === "all" || post.review === filter) &&
                      `${post.title} ${post.copy}`.includes(search),
                  )}
                  columns={[
                    {
                      title: "帖子",
                      dataIndex: "title",
                      render: (_, post) => (
                        <div>
                          <strong>{post.title}</strong>
                          <p className="post-copy-excerpt">{post.copy}</p>
                          <Space wrap>
                            {post.tags.map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                          </Space>
                        </div>
                      ),
                    },
                    {
                      title: "素材 / 语种",
                      render: (_, post) => (
                        <span>
                          {post.media.length
                            ? `${post.media.length} ${post.media[0].kind === "video" ? "个视频" : "张图片"}`
                            : "纯文字"}
                          <br />
                          {post.language}
                        </span>
                      ),
                      width: 130,
                    },
                    {
                      title: "状态",
                      render: (_, post) => (
                        <>
                          <Tag
                            color={
                              post.review === "approved" ? "success" : "warning"
                            }
                          >
                            {post.review === "approved" ? "已审核" : "待审核"}
                          </Tag>
                          {data.tasks.some(
                            (task) =>
                              task.postId === post.id &&
                              task.status !== "cancelled",
                          ) && <Tag>已安排发布</Tag>}
                        </>
                      ),
                      width: 140,
                    },
                    {
                      title: "操作",
                      width: 250,
                      render: (_, post) => {
                        const assigned = data.tasks.some(
                          (task) =>
                            task.postId === post.id &&
                            task.status !== "cancelled",
                        );
                        return (
                          <Space wrap>
                            <Button
                              size="small"
                              onClick={() => setPreview(post)}
                            >
                              预览
                            </Button>
                            <Button
                              size="small"
                              disabled={assigned}
                              onClick={() => openEditor(post)}
                            >
                              编辑
                            </Button>
                            <Button
                              size="small"
                              disabled={assigned}
                              onClick={() => {
                                void run(
                                  "post.review",
                                  {
                                    id: post.id,
                                    approved: post.review !== "approved",
                                  },
                                  "审核状态已更新",
                                ).catch(() => {});
                              }}
                            >
                              {post.review === "approved"
                                ? "撤回审核"
                                : "审核通过"}
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              disabled={
                                assigned ||
                                post.review !== "approved" ||
                                !data.pages.some((page) => page.connected)
                              }
                              onClick={() => {
                                setPublish(post);
                                publishForm.resetFields();
                                publishForm.setFieldsValue({ format: "feed" });
                              }}
                            >
                              安排发布
                            </Button>
                            <Popconfirm
                              title="删除此帖子？"
                              onConfirm={() =>
                                run("post.delete", { id: post.id })
                              }
                            >
                              <Button
                                size="small"
                                danger
                                disabled={data.tasks.some(
                                  (task) => task.postId === post.id,
                                )}
                              >
                                删除
                              </Button>
                            </Popconfirm>
                          </Space>
                        );
                      },
                    },
                  ]}
                  locale={{ emptyText: "从“新建帖子”开始，或使用批量生成。" }}
                />
              </Card>
            ),
          },
          {
            key: "generate",
            label: "批量生成",
            children: (
              <div className="publishing-grid">
                <Card bordered={false} title="文案与素材">
                  <Form
                    form={generateForm}
                    layout="vertical"
                    onValuesChange={(_, values) => setGenerationDraft(values)}
                    initialValues={{
                      mode: "template",
                      language: "简体中文",
                      templateId: data.templates[0]?.id,
                      quantity: 1,
                      imagesPerPost: 0,
                      tags: [],
                      ...generationDraft,
                    }}
                  >
                    <div className="form-grid">
                      <Form.Item name="mode" label="生成方式">
                        <Select
                          options={[
                            { value: "template", label: "本地模板" },
                            { value: "ai", label: "AI 文案（使用已配置接口）" },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="language" label="目标语种">
                        <Select options={languages} />
                      </Form.Item>
                    </div>
                    <Form.Item
                      name="title"
                      label="产品 / 短剧名称"
                      rules={[{ required: true, message: "请输入名称" }]}
                    >
                      <Input maxLength={200} />
                    </Form.Item>
                    <Form.Item name="description" label="产品资料 / 剧情介绍">
                      <Input.TextArea
                        rows={5}
                        maxLength={20000}
                        placeholder="填写卖点、剧情、受众或希望强调的信息。"
                      />
                    </Form.Item>
                    <Form.Item name="tags" label="内容标签">
                      <Select
                        mode="tags"
                        tokenSeparators={[",", "，"]}
                        placeholder="用于主页自动发帖匹配"
                      />
                    </Form.Item>
                    <Form.Item
                      name="templateId"
                      label="文案模板"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={data.templates.map((t) => ({
                          value: t.id,
                          label: t.name,
                        }))}
                      />
                    </Form.Item>
                    <div className="form-grid">
                      <Form.Item
                        name="quantity"
                        label={
                          generationMedia.some((m) => m.kind === "video")
                            ? `每个视频生成一条，共 ${generationMedia.length} 条`
                            : "生成数量"
                        }
                      >
                        <InputNumber
                          min={1}
                          max={50}
                          disabled={generationMedia.some(
                            (m) => m.kind === "video",
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name="imagesPerPost"
                        label="每条引用图片数（0 为纯文字）"
                      >
                        <InputNumber
                          min={0}
                          max={10}
                          disabled={generationMedia.some(
                            (m) => m.kind === "video",
                          )}
                        />
                      </Form.Item>
                    </div>
                    <Space wrap>
                      <Button
                        onClick={() => {
                          void chooseMedia(true);
                        }}
                      >
                        选择本地素材
                      </Button>
                      <Link to="/settings/services">管理 AI 接口 →</Link>
                      <Button
                        onClick={() => {
                          setTemplate(true);
                          templateForm.resetFields();
                        }}
                      >
                        新建模板
                      </Button>
                    </Space>
                    {imported(generationMedia, setGenerationMedia)}
                    <Alert
                      type="info"
                      message="AI 模式会将上方填写的资料和模板发送给配置的接口；本地视频与图片不发送给 AI。生成结果先进入待审核。"
                      className="my-4"
                    />
                    <Button type="primary" loading={busy} onClick={generate}>
                      生成待审核帖子
                    </Button>
                  </Form>
                </Card>
                <Card bordered={false} title="生成记录">
                  {generationResult.length ? (
                    <List
                      dataSource={generationResult}
                      renderItem={(row, index) => (
                        <List.Item>
                          <Tag color={row.id ? "success" : "error"}>
                            第 {index + 1} 条
                          </Tag>
                          {row.id ? "已生成，等待审核" : row.error}
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty description="填写资料后开始生成，成功与失败逐条显示。" />
                  )}
                  <p className="muted">
                    图片可在多条内容中轮换；每个视频仅关联一条内容，防止重复消耗素材。
                  </p>
                </Card>
              </div>
            ),
          },
          {
            key: "templates",
            label: "文案模板",
            children: (
              <Card
                bordered={false}
                extra={
                  <Button
                    onClick={() => {
                      setTemplate(true);
                      templateForm.resetFields();
                    }}
                  >
                    新建模板
                  </Button>
                }
              >
                <List
                  dataSource={data.templates}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button
                          key="edit"
                          onClick={() => {
                            setTemplate(true);
                            templateForm.setFieldsValue(item);
                          }}
                        >
                          编辑
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={item.name}
                        description={
                          <pre className="template-copy">{item.body}</pre>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title={editor === "new" ? "新建帖子" : "编辑帖子"}
        open={Boolean(editor)}
        onCancel={() => setEditor(null)}
        width={960}
        onOk={save}
        confirmLoading={busy}
        okText="保存帖子"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="publishing-grid">
          <Form form={form} layout="vertical">
            <Form.Item
              name="title"
              label="帖子标题"
              rules={[{ required: true, message: "请输入标题" }]}
            >
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="copy" label="文案正文">
              <Input.TextArea rows={8} maxLength={60000} showCount />
            </Form.Item>
            <div className="form-grid">
              <Form.Item name="language" label="语种">
                <Select options={languages} />
              </Form.Item>
              <Form.Item name="review" label="审核状态">
                <Select
                  options={[
                    { value: "pending", label: "待审核" },
                    { value: "approved", label: "已审核" },
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item name="tags" label="内容标签">
              <Select mode="tags" tokenSeparators={[",", "，"]} />
            </Form.Item>
            <Space wrap>
              <Button
                onClick={() => {
                  void chooseMedia();
                }}
              >
                添加本地图片 / 视频
              </Button>
              <Select
                placeholder="选用已处理成片"
                style={{ width: 210 }}
                value={undefined}
                onChange={(path) => {
                  void chooseMedia(false, path);
                }}
                options={jobs
                  .filter((job) => job.status === "success" && job.output)
                  .map((job) => ({ value: job.output!, label: job.name }))}
              />
            </Space>
            {imported(media, setMedia)}
          </Form>
          <div className="post-preview">
            <span className="section-label">帖子预览</span>
            <p className="post-preview-copy">{copy || "文案预览显示在这里"}</p>
            <MediaPreview media={media} />
            <small className="muted">每条最多 10 张图片或 1 个视频。</small>
          </div>
        </div>
      </Modal>
      <Modal
        title="文案模板"
        open={template}
        onCancel={() => setTemplate(false)}
        okText="保存模板"
        cancelText="取消"
        onOk={async () => {
          try {
            await run("template.save", await templateForm.validateFields());
            setTemplate(false);
          } catch {}
        }}
      >
        <Form form={templateForm} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="body" label="模板正文" rules={[{ required: true }]}>
            <Input.TextArea rows={9} />
          </Form.Item>
          <p className="muted">
            变量：{"{title}、{description}、{language}、{tags}、{index}"}
          </p>
        </Form>
      </Modal>
      <Modal
        title="安排 Facebook 主页发布"
        open={Boolean(publish)}
        onCancel={() => setPublish(null)}
        onOk={submitPublish}
        okText="创建发布任务"
        cancelText="取消"
      >
        <Form form={publishForm} layout="vertical">
          <Form.Item
            name="pageId"
            label="目标主页"
            rules={[{ required: true, message: "请选择主页" }]}
          >
            <Select
              options={data.pages
                .filter((page) => page.connected)
                .map((page) => ({ value: page.id, label: page.name }))}
            />
          </Form.Item>
          <Form.Item name="format" label="发布形式">
            <Select
              options={[
                { value: "feed", label: "主页帖子（文字 / 图片 / 视频）" },
                { value: "reel", label: "Facebook Reels（单视频）" },
              ]}
            />
          </Form.Item>
          <Form.Item name="when" label="本机时间（留空立即进入发布队列）">
            <Input type="datetime-local" />
          </Form.Item>
          <Alert
            type="warning"
            message={
              data.paused
                ? "全局发布已暂停，任务将等待你恢复。"
                : "创建后会按所选时间上传素材并发布到主页，请确认内容与目标主页。"
            }
          />
        </Form>
      </Modal>
      <Modal
        title={preview?.title}
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        footer={null}
      >
        <p className="post-preview-copy">{preview?.copy}</p>
        <MediaPreview media={preview?.media || []} />
      </Modal>
    </>
  );
}

export function AuthorizationsPage() {
  const { data, error, run } = usePublishing();
  const [manualForm] = Form.useForm();
  const [callbackForm] = Form.useForm();
  const [manual, setManual] = useState(false);
  const [rule, setRule] = useState<FacebookPage | null>(null);
  const [ruleForm] = Form.useForm();
  if (!data) return <Loading error={error} />;
  const saveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      await run("page.rule", { id: rule!.id, rule: values });
      setRule(null);
    } catch {}
  };
  return (
    <>
      <PageTitle
        title="主页授权"
        detail="使用你自己的 Meta 应用连接 Facebook 主页。授权在系统浏览器中进行，令牌仅在本机加密保存。"
        extra={<Link to="/settings/services">管理 Meta 应用配置 →</Link>}
      />
      {!data.secureStorage && (
        <Alert
          type="error"
          showIcon
          message="系统安全存储不可用，暂时无法保存 App Secret 或授权令牌。"
          className="mb-4"
        />
      )}
      <div className="authorization-layout">
        <Card
          bordered={false}
          title="连接 Facebook 主页"
          extra={
            <Tag color={data.app.hasSecret ? "success" : "warning"}>
              {data.app.hasSecret ? "应用已配置" : "请先配置应用"}
            </Tag>
          }
        >
          {!data.app.hasSecret && (
            <Alert
              type="info"
              className="mb-5"
              message={
                <span>
                  还未配置 Meta 应用，请先到{" "}
                  <Link to="/settings/services">服务配置</Link> 填写应用信息。
                </span>
              }
            />
          )}
          {data.app.hasSecret && (
            <p className="muted">
              当前应用：{data.app.appId} · {data.app.version}
            </p>
          )}
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <p>
              所需权限：pages_show_list、pages_read_engagement、pages_manage_posts。
            </p>
            <Button
              type="primary"
              disabled={!data.app.hasSecret}
              onClick={() => {
                void run("auth.start", {}, "已打开授权浏览器").catch(() => {});
              }}
            >
              打开 Facebook 官方授权
            </Button>
            <Alert
              type={
                data.authorization.status === "completed"
                  ? "success"
                  : data.authorization.status === "failed"
                    ? "error"
                    : "info"
              }
              message={data.authorization.message}
            />
            {data.authorization.url && (
              <Typography.Paragraph copyable={{ text: data.authorization.url }}>
                复制授权链接（10 分钟内有效）
              </Typography.Paragraph>
            )}
            <Form form={callbackForm} layout="vertical">
              <Form.Item
                name="url"
                label="手动返回：粘贴浏览器完整回调 URL"
                rules={[{ required: true }]}
              >
                <Input.Password
                  placeholder="https://已登记回调地址?code=…&state=…"
                  autoComplete="off"
                />
              </Form.Item>
              <Button
                disabled={data.authorization.status !== "pending"}
                onClick={async () => {
                  try {
                    await run(
                      "auth.complete",
                      await callbackForm.validateFields(),
                      "授权已完成",
                    );
                    callbackForm.resetFields();
                  } catch {}
                }}
              >
                完成回调授权
              </Button>
            </Form>
            <Space>
              <Button onClick={() => setManual(true)}>导入用户访问令牌</Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  void run("auth.refresh", {}, "主页已同步").catch(() => {});
                }}
              >
                同步已授权主页
              </Button>
            </Space>
            <p className="muted">
              官方接口发布目标为主页。普通 Facebook
              个人时间线不受支持。非应用角色用户可能需要 Meta
              审核和权限高级访问。
            </p>
          </Space>
        </Card>
      </div>
      <Card
        bordered={false}
        className="mt-5"
        title={`已连接主页（${data.pages.filter((page) => page.connected).length}）`}
      >
        <Table
          rowKey="id"
          pagination={{ pageSize: 6 }}
          dataSource={data.pages}
          columns={[
            {
              title: "主页",
              render: (_, page) => (
                <>
                  <strong>{page.name}</strong>
                  <p className="muted">
                    {page.id} · {page.category}
                  </p>
                </>
              ),
            },
            {
              title: "授权",
              render: (_, page) => (
                <Tag color={page.connected ? "success" : "error"}>
                  {page.connected ? "已连接" : "需重新授权"}
                </Tag>
              ),
            },
            {
              title: "自动发帖",
              render: (_, page) => (
                <>
                  <Tag color={page.rule.enabled ? "processing" : "default"}>
                    {page.rule.enabled ? "已开启" : "未开启"}
                  </Tag>
                  <p>
                    {page.rule.start} – {page.rule.end} · 间隔{" "}
                    {page.rule.intervalHours} 小时
                  </p>
                  <small className="muted">
                    滚动 24 小时限额：{page.rule.dailyLimit || "不限"} ·{" "}
                    {page.rule.tags.join("、") || "未配置内容标签"}
                  </small>
                </>
              ),
            },
            {
              title: "操作",
              render: (_, page) => (
                <Space>
                  <Button
                    onClick={() => {
                      setRule(page);
                      ruleForm.setFieldsValue(page.rule);
                    }}
                  >
                    发布规则
                  </Button>
                  <Popconfirm
                    title="断开本地主页连接并取消等待任务？"
                    description="这不会撤销 Meta 网站上的应用权限。"
                    onConfirm={() =>
                      run("page.disconnect", { id: page.id }, "已断开连接")
                    }
                  >
                    <Button danger disabled={!page.connected}>
                      断开连接
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "完成官方授权后，这里会列出可发布的主页。" }}
        />
      </Card>
      <Modal
        title={`自动发帖规则 · ${rule?.name}`}
        open={Boolean(rule)}
        onCancel={() => setRule(null)}
        onOk={saveRule}
        okText="保存规则"
        cancelText="取消"
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="enabled"
            label="自动选择已审核内容并发布"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="tags" label="匹配内容标签（至少匹配一个）">
            <Select mode="tags" tokenSeparators={[",", "，"]} />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="dailyLimit" label="滚动 24 小时发布上限（0 不限）">
              <InputNumber min={0} max={100} />
            </Form.Item>
            <Form.Item name="intervalHours" label="最小发布间隔（小时）">
              <InputNumber min={0.05} max={720} step={0.5} />
            </Form.Item>
            <Form.Item name="start" label="窗口开始（本机时间）">
              <Input type="time" />
            </Form.Item>
            <Form.Item name="end" label="窗口结束（支持跨午夜）">
              <Input type="time" />
            </Form.Item>
          </div>
          <Form.Item name="format" label="默认发布形式">
            <Select
              options={[
                { value: "feed", label: "主页帖子" },
                { value: "reel", label: "Facebook Reels（只匹配视频）" },
              ]}
            />
          </Form.Item>
          <Alert
            type="warning"
            message="启用后，应用运行期间会自动挑选符合标签的已审核帖子并发布。每条内容只会分配一个发布任务。"
          />
        </Form>
      </Modal>
      <Modal
        title="导入 Facebook 用户访问令牌"
        open={manual}
        onCancel={() => {
          setManual(false);
          manualForm.resetFields();
        }}
        okText="验证并连接主页"
        cancelText="取消"
        onOk={async () => {
          try {
            await run(
              "auth.import",
              await manualForm.validateFields(),
              "主页已连接",
            );
            setManual(false);
            manualForm.resetFields();
          } catch {}
        }}
      >
        <Form form={manualForm} layout="vertical">
          <Form.Item
            name="token"
            label="User Access Token（由你自己的 Meta 应用生成）"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="off" />
          </Form.Item>
          <p className="muted">
            应用会先验证已授予权限，再读取可管理主页及 Page
            Token。请勿填写其他人的令牌。
          </p>
        </Form>
      </Modal>
    </>
  );
}

export function PublishTasksPage() {
  const { data, error, run } = usePublishing();
  const [filter, setFilter] = useState("all");
  if (!data) return <Loading error={error} />;
  const active = data.tasks.filter((task) =>
    ["queued", "publishing", "processing"].includes(task.status),
  ).length;
  return (
    <>
      <PageTitle
        title="发布任务"
        detail="查看每次发布的内容快照、上传结果和失败原因。关闭应用后暂停本机调度，重新打开后继续待执行任务。"
        extra={
          <Button
            type={data.paused ? "primary" : "default"}
            onClick={() => {
              void run(
                "scheduler.pause",
                { paused: !data.paused },
                data.paused ? "发布调度已恢复" : "发布调度已暂停",
              ).catch(() => {});
            }}
          >
            {data.paused ? "恢复发布调度" : "暂停发布调度"}
          </Button>
        }
      />
      <Alert
        showIcon
        type={data.paused ? "warning" : "info"}
        message={
          data.paused
            ? "全局发布已暂停。正在上传的任务会继续完成，等待任务不会启动。"
            : `本机调度运行中 · ${active} 个等待或处理中的任务`
        }
        className="mb-5"
      />
      <Card bordered={false}>
        <div className="table-toolbar">
          <Select
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部状态" },
              ...Object.entries(taskLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </div>
        <Table
          rowKey="id"
          pagination={{ pageSize: 8 }}
          dataSource={data.tasks.filter(
            (task) => filter === "all" || task.status === filter,
          )}
          columns={[
            {
              title: "内容 / 主页",
              render: (_, task) => (
                <>
                  <strong>{task.snapshot.title}</strong>
                  <p>
                    {data.pages.find((page) => page.id === task.pageId)?.name ||
                      task.pageId}{" "}
                    · {task.format === "reel" ? "Reels" : "主页帖子"}
                  </p>
                  <p className="post-copy-excerpt">{task.snapshot.copy}</p>
                </>
              ),
            },
            {
              title: "计划时间（本机）",
              render: (_, task) => (
                <>
                  {new Date(task.scheduledAt).toLocaleString("zh-CN")}
                  <p className="muted">已尝试 {task.attempts} 次</p>
                </>
              ),
              width: 190,
            },
            {
              title: "状态",
              render: (_, task) => (
                <>
                  <Tag
                    color={
                      task.status === "published"
                        ? "success"
                        : ["failed", "uncertain"].includes(task.status)
                          ? "error"
                          : "processing"
                    }
                  >
                    {taskLabels[task.status]}
                  </Tag>
                  {task.error && <p className="error-text">{task.error}</p>}
                  {task.remoteId && (
                    <p className="muted">远端编号：{task.remoteId}</p>
                  )}
                </>
              ),
              width: 240,
            },
            {
              title: "操作",
              width: 180,
              render: (_, task) => (
                <Space wrap>
                  {task.url && (
                    <Button
                      size="small"
                      onClick={() => {
                        void window.electronAPI.openPost(task.id);
                      }}
                    >
                      查看帖子
                    </Button>
                  )}
                  {task.status === "queued" && (
                    <Button
                      size="small"
                      onClick={() => {
                        void run(
                          "task.action",
                          { id: task.id, action: "cancel" },
                          "已取消任务",
                        ).catch(() => {});
                      }}
                    >
                      取消
                    </Button>
                  )}
                  {task.status === "failed" && (
                    <Popconfirm
                      title="重新尝试此发布任务？"
                      onConfirm={() =>
                        run(
                          "task.action",
                          { id: task.id, action: "retry" },
                          "已重新排队",
                        )
                      }
                    >
                      <Button size="small">重试</Button>
                    </Popconfirm>
                  )}
                  {["uncertain", "processing"].includes(task.status) &&
                    task.remoteId && (
                      <Button
                        size="small"
                        onClick={() => {
                          void run(
                            "task.action",
                            { id: task.id, action: "check" },
                            "状态已查询",
                          ).catch(() => {});
                        }}
                      >
                        核实结果
                      </Button>
                    )}
                  {task.status === "uncertain" && !task.remoteId && (
                    <small className="muted">
                      请到 Facebook 主页人工核实，不能直接重发。
                    </small>
                  )}
                </Space>
              ),
            },
          ]}
          locale={{
            emptyText: "在帖子内容中安排发布，或在主页授权中启用自动发帖。",
          }}
        />
      </Card>
    </>
  );
}
