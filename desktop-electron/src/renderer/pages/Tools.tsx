import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
} from "antd";
import { stringify } from "yaml";
import { call, useStore } from "../store";
import { FileField, JobProgress, PageTitle } from "../components";
import { terminal, type Json } from "../types";

export function Profiles() {
  const { data, refresh } = useStore();
  const { message } = App.useApp();
  const [kind, setKind] = useState("native");
  const [profileId, setProfileId] = useState(data.profiles[0]?.id);
  const [text, setText] = useState(data.profiles[0]?.yaml || "");
  const [name, setName] = useState("我的处理配置");
  const [validation, setValidation] = useState("");
  const [pending, setPending] = useState(false);
  const selected = data.profiles.find((profile) => profile.id === profileId);
  const choose = (id: string) => {
    setProfileId(id);
    setText(data.profiles.find((profile) => profile.id === id)?.yaml || "");
    setValidation("");
  };
  const validate = async () => {
    setPending(true);
    try {
      await call("config.validate", { kind, yaml: text });
      setValidation("校验通过");
      message.success("配置校验通过");
    } catch (failure) {
      setValidation(String(failure));
      message.error("配置校验未通过，请检查下方提示");
    } finally {
      setPending(false);
    }
  };
  const save = async (overwrite = false) => {
    setPending(true);
    try {
      if (kind === "reels") await call("rules.save", { yaml: text });
      else
        await call("profiles.save", {
          yaml: text,
          name: overwrite
            ? selected?.id.split(/[\\/]/).pop()?.replace(".yaml", "")
            : name,
          overwrite,
        });
      await refresh();
      message.success("配置已保存");
    } catch (failure) {
      message.error(String(failure));
    } finally {
      setPending(false);
    }
  };
  const importConfig = async () => {
    const [path] = await window.electronAPI.pick("config");
    if (path) {
      setText(await window.electronAPI.readText(path));
      setValidation("");
    }
  };
  return (
    <>
      <PageTitle
        title="处理配置"
        detail="复用原项目的 YAML 与 Schema 校验。内置配置保存为副本，自定义配置可直接更新。"
      />
      <Card bordered={false}>
        <div className="table-toolbar">
          <Select
            aria-label="配置类型"
            value={kind}
            onChange={(next) => {
              setKind(next);
              setValidation("");
              setText(
                next === "reels" ? stringify(data.rules) : selected?.yaml || "",
              );
            }}
            options={[
              { value: "native", label: "通用处理配置" },
              { value: "reels", label: "短剧交付规则" },
            ]}
          />
          {kind === "native" && (
            <Select
              aria-label="选择配置"
              className="flex-1"
              value={profileId}
              onChange={choose}
              options={data.profiles.map((profile) => ({
                value: profile.id,
                label: `${profile.name}${profile.custom ? " · 自定义" : " · 内置"}`,
              }))}
            />
          )}
          <Button onClick={importConfig}>导入 YAML</Button>
        </div>
        <Input.TextArea
          aria-label="YAML 配置编辑器"
          className="yaml-editor"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setValidation("");
          }}
          autoSize={{ minRows: 18, maxRows: 28 }}
        />
        {validation && (
          <Alert
            className="mt-4"
            showIcon
            type={validation === "校验通过" ? "success" : "error"}
            message={validation}
          />
        )}
        <div className="profile-actions">
          <Button loading={pending} onClick={validate}>
            校验配置
          </Button>
          {kind === "native" && (
            <Input
              aria-label="新配置名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="新配置名称"
            />
          )}
          <Button type="primary" loading={pending} onClick={() => save(false)}>
            {kind === "reels" ? "保存为默认交付规则" : "另存为新配置"}
          </Button>
          {selected?.custom && kind === "native" && (
            <Button onClick={() => save(true)}>保存当前配置</Button>
          )}
        </div>
      </Card>
    </>
  );
}

export function Calibrate({ variants }: { variants?: boolean }) {
  const { data, jobs, submit } = useStore();
  const { message } = App.useApp();
  const [source, setSource] = useState("");
  const [values, setValues] = useState<Json>({
    profile: data.profiles.find((p) => p.name === "cid_aware")?.id,
    iterations: 5,
    sample_duration: 60,
    max_self_match: 0.2,
    min_quality: 88,
    count: 3,
  });
  const [jobId, setJobId] = useState("");
  const [pending, setPending] = useState(false);
  const job = jobs.find((entry) => entry.id === jobId);
  const set = (key: string, value: unknown) =>
    setValues({ ...values, [key]: value });
  const start = async () => {
    setPending(true);
    try {
      const created = await submit({
        ...values,
        source,
        kind: variants ? "variants" : "calibrate",
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
        title={variants ? "实验版本" : "自动调参"}
        detail={
          variants
            ? "以原处理引擎生成多个版本，用于自有素材的本地回归测试。"
            : "限定搜索次数，基于实际画面质量与本地指纹指标，选择处理参数。"
        }
      />
      <Card bordered={false}>
        <FileField label="源视频" path={source} onChange={setSource} />
        <Form layout="vertical">
          <div className="form-grid">
            <Form.Item label="基础配置">
              <Select
                value={values.profile}
                options={data.profiles.map((profile) => ({
                  value: profile.id,
                  label: profile.name,
                }))}
                onChange={(value) => set("profile", value)}
              />
            </Form.Item>
            {variants ? (
              <Form.Item label="版本数量">
                <InputNumber
                  min={1}
                  max={30}
                  value={values.count}
                  onChange={(value) => set("count", value)}
                />
              </Form.Item>
            ) : (
              <>
                <Form.Item label="最大搜索次数">
                  <InputNumber
                    min={1}
                    max={15}
                    value={values.iterations}
                    onChange={(value) => set("iterations", value)}
                  />
                </Form.Item>
                <Form.Item label="本地相似度上限">
                  <InputNumber
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={values.max_self_match}
                    onChange={(value) => set("max_self_match", value)}
                  />
                </Form.Item>
                <Form.Item label="最低质量（0–100）">
                  <InputNumber
                    min={60}
                    max={100}
                    value={values.min_quality}
                    onChange={(value) => set("min_quality", value)}
                  />
                </Form.Item>
                <Form.Item label="采样时长（秒）">
                  <InputNumber
                    min={10}
                    max={600}
                    value={values.sample_duration}
                    onChange={(value) => set("sample_duration", value)}
                  />
                </Form.Item>
              </>
            )}
          </div>
        </Form>
        <Alert
          showIcon
          type="info"
          message={
            variants
              ? "每个版本使用新的随机种子，并生成质量报告。所有结果只保存在本机。"
              : "使用现有 Chromaprint 与画质指标，不使用 AI 模型；本地分数不预测外部平台审核。"
          }
        />
        <Button
          className="mt-5"
          type="primary"
          disabled={!source || Boolean(job && !terminal(job))}
          loading={pending}
          onClick={start}
        >
          {variants ? "生成实验版本" : "开始自动调参"}
        </Button>
        <JobProgress job={job} />
        {job?.result?.steps && (
          <Table
            className="mt-5"
            rowKey="iteration"
            size="small"
            pagination={false}
            dataSource={job.result.steps}
            columns={[
              { title: "迭代", dataIndex: "iteration" },
              {
                title: "强度",
                dataIndex: "intensity_factor",
                render: (v: number) => v.toFixed(3),
              },
              {
                title: "本地相似度",
                dataIndex: "self_match",
                render: (v: number) => v.toFixed(3),
              },
              {
                title: "画面质量",
                dataIndex: "quality",
                render: (v: number | null) => v?.toFixed(2) || "未测量",
              },
              { title: "质量指标", dataIndex: "quality_metric" },
            ]}
          />
        )}
        {job?.result?.profile && (
          <Alert
            className="mt-4"
            showIcon
            type="success"
            message="已保存调参后的配置，可在处理配置页和通用处理方式中选用。"
          />
        )}
        {job?.result?.variants && (
          <Table
            className="mt-5"
            rowKey="variant_id"
            dataSource={job.result.variants}
            columns={[
              { title: "版本", dataIndex: "variant_id" },
              { title: "成片", dataIndex: "output", ellipsis: true },
              {
                title: "操作",
                dataIndex: "output",
                render: (path: string) => (
                  <Button onClick={() => window.electronAPI.reveal(path)}>
                    定位文件
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
