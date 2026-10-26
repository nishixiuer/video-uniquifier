import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Tag } from "antd";
import { PageTitle } from "../components";
import { PublishingLoading, usePublishing } from "./publishing-state";
import TemplateLibrary from "./TemplateLibrary";

export default function PublishingSettings() {
  const { data, error, run } = usePublishing();
  const [appForm] = Form.useForm();
  const [aiForm] = Form.useForm();
  const [saving, setSaving] = useState<"app" | "ai" | null>(null);
  if (!data) return <PublishingLoading error={error} />;
  const save = async (kind: "app" | "ai") => {
    const form = kind === "app" ? appForm : aiForm;
    try {
      const values = await form.validateFields();
      setSaving(kind);
      await run(
        kind === "app" ? "app.save" : "ai.save",
        values,
        kind === "app" ? "Meta 应用配置已保存" : "AI 接口已保存",
      );
      form.setFieldValue(kind === "app" ? "secret" : "key", "");
    } catch {
      /* Form validation and service errors are shown in place. */
    } finally {
      setSaving(null);
    }
  };
  return (
    <>
      <PageTitle
        title="服务配置"
        detail="集中管理 Facebook 发布与 AI 文案接口。保存后即可前往对应功能使用。"
      />
      {!data.secureStorage && (
        <Alert
          className="mb-5"
          type="error"
          showIcon
          message="系统安全存储不可用，暂时无法保存密钥和授权令牌。"
        />
      )}
      <div className="publishing-grid service-settings">
        <Card
          bordered={false}
          title="Facebook · Meta 应用"
          extra={
            <Tag color={data.app.hasSecret ? "success" : "default"}>
              {data.app.hasSecret ? "已配置" : "待配置"}
            </Tag>
          }
        >
          <p className="muted">
            用于官方主页授权与发帖。已有主页连接会继续使用已保存的配置。
          </p>
          <Form form={appForm} layout="vertical" initialValues={data.app}>
            <Form.Item
              name="appId"
              label="Meta App ID"
              rules={[{ required: true, message: "请输入 App ID" }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="secret"
              label={
                data.app.hasSecret
                  ? "App Secret（已加密保存，留空保留）"
                  : "App Secret"
              }
            >
              <Input.Password autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="version"
              label="Graph API 版本"
              rules={[{ required: true }]}
            >
              <Input placeholder="v26.0" />
            </Form.Item>
            <Form.Item
              name="redirectUri"
              label="OAuth 回调地址"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Alert
              type="info"
              message="在 Meta 应用中登记完全一致的 OAuth 回调地址。本机 HTTP 是否可用取决于应用设置；HTTPS 回调可在主页授权页手动完成。"
              className="mb-5"
            />
            <div className="settings-actions">
              <Button
                type="primary"
                loading={saving === "app"}
                disabled={saving === "ai"}
                onClick={() => {
                  void save("app");
                }}
              >
                保存应用配置
              </Button>
              <Link to="/publishing/pages">前往主页授权 →</Link>
            </div>
          </Form>
        </Card>
        <Card
          bordered={false}
          title="AI · 文案生成接口"
          extra={
            <Tag color={data.ai.model ? "success" : "default"}>
              {data.ai.model ? "已配置" : "可选配置"}
            </Tag>
          }
        >
          <p className="muted">
            支持兼容 Chat Completions 的服务。不使用 AI
            时，可直接用本地模板生成文案。
          </p>
          <Form form={aiForm} layout="vertical" initialValues={data.ai}>
            <Form.Item
              name="baseUrl"
              label="Base URL（包含 /v1，不包含 /chat/completions）"
              rules={[{ required: true }]}
            >
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>
            <Form.Item
              name="model"
              label="模型名称"
              rules={[{ required: true, message: "请输入模型名称" }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="key"
              label={
                data.ai.hasKey
                  ? "API Key（已加密保存，留空保留）"
                  : "API Key（本机无鉴权接口可留空）"
              }
            >
              <Input.Password autoComplete="off" />
            </Form.Item>
            <Alert
              type="info"
              message="密钥仅在本机加密保存。本地模型可使用 localhost HTTP 地址；AI 生成只发送你填写的文字资料。"
              className="mb-5"
            />
            <div className="settings-actions">
              <Button
                type="primary"
                loading={saving === "ai"}
                disabled={saving === "app"}
                onClick={() => {
                  void save("ai");
                }}
              >
                保存 AI 接口
              </Button>
              <Link to="/workspace/production">前往批量制作 →</Link>
              <Link to="/tools/copywriter">前往文案工具 →</Link>
            </div>
          </Form>
        </Card>
      </div>
      <TemplateLibrary
        templates={data.templates}
        save={(input) => run("template.save", input, "模板已保存")}
      />
    </>
  );
}
