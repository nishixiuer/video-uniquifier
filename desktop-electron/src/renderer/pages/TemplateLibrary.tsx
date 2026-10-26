import { useState } from "react";
import { Button, Card, Form, Input, List, Modal } from "antd";
import type { CopyTemplate } from "../../shared/publishing";

export default function TemplateLibrary({
  templates,
  save,
}: {
  templates: CopyTemplate[];
  save: (input: CopyTemplate) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const edit = (template?: CopyTemplate) => {
    form.resetFields();
    if (template) form.setFieldsValue(template);
    setOpen(true);
  };
  return (
    <Card
      id="templates"
      className="mt-6"
      bordered={false}
      title="推广文案提示词 / 本地模板"
      extra={<Button onClick={() => edit()}>新建模板</Button>}
    >
      <p className="muted">
        AI
        模式把模板作为生成要求；离线模式直接替换变量。批量制作会保存模板快照，后续修改只影响新批次。
      </p>
      <List
        dataSource={templates}
        renderItem={(template) => (
          <List.Item
            actions={[
              <Button key="edit" onClick={() => edit(template)}>
                编辑
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={template.name}
              description={<pre className="template-copy">{template.body}</pre>}
            />
          </List.Item>
        )}
      />
      <Modal
        title="文案模板"
        open={open}
        okText="保存模板"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            const input = await form.validateFields();
            setBusy(true);
            await save(input);
            setOpen(false);
          } catch {
            // Form and service errors are displayed by their existing boundaries.
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item
            name="body"
            label="模板正文"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={9} maxLength={20000} />
          </Form.Item>
          <p className="muted">
            变量：{"{title}、{description}、{language}、{tags}、{index}"}
          </p>
        </Form>
      </Modal>
    </Card>
  );
}
