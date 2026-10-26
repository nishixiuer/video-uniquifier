import { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  ConfigProvider,
  Form,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  theme,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import { CheckCircleOutlined } from "@ant-design/icons";
import Sidebar, { navigationEntries } from "./Sidebar";
import { StoreProvider, useStore } from "./store";
import { CompareModal, PageTitle, ReportModal } from "./components";
import Process from "./pages/Process";
import Batch from "./pages/Batch";
import { CorpusPage, History, Quality } from "./pages/Library";
import { Calibrate, Profiles } from "./pages/Tools";
import Queue from "./pages/Queue";
import { terminal, type Job } from "./types";
import "antd/dist/reset.css";
import "./styles.css";

const PostsPage = lazy(() =>
  import("./pages/Publishing").then((module) => ({
    default: module.PostsPage,
  })),
);
const AuthorizationsPage = lazy(() =>
  import("./pages/Publishing").then((module) => ({
    default: module.AuthorizationsPage,
  })),
);
const PublishTasksPage = lazy(() =>
  import("./pages/Publishing").then((module) => ({
    default: module.PublishTasksPage,
  })),
);
const PublishingSettings = lazy(() => import("./pages/PublishingSettings"));
const Materials = lazy(() => import("./pages/Materials"));
const Production = lazy(() => import("./pages/Production"));

function SettingsPage() {
  const { data, settings, setSettings } = useStore();
  const [draft, setDraft] = useState(settings);
  return (
    <>
      <PageTitle
        title="设置"
        detail="应用默认使用简体中文。界面修改即时热更新，Python 仅负责本地视频处理。"
      />
      <div className="settings-layout">
        <Card bordered={false}>
          <h2>界面与默认值</h2>
          <Form layout="vertical">
            <Form.Item label="界面语言">
              <Select
                value="zh_CN"
                options={[{ value: "zh_CN", label: "简体中文" }]}
              />
            </Form.Item>
            <Form.Item label="外观">
              <Radio.Group
                value={draft.theme}
                onChange={(event) =>
                  setDraft({ ...draft, theme: event.target.value })
                }
                options={[
                  { value: "dark", label: "深色工作台" },
                  { value: "light", label: "浅色工作台" },
                ]}
              />
            </Form.Item>
            <Form.Item label="默认处理方式">
              <Select
                value={draft.method}
                onChange={(value) => setDraft({ ...draft, method: value })}
                options={[
                  { value: "reels", label: "短剧视频交付（Facebook Reels）" },
                  { value: "native", label: "通用视频处理" },
                ]}
              />
            </Form.Item>
            <Form.Item label="减少界面动效">
              <Switch
                checked={draft.reducedMotion}
                onChange={(checked) =>
                  setDraft({ ...draft, reducedMotion: checked })
                }
              />
            </Form.Item>
            <Button type="primary" onClick={() => setSettings(draft)}>
              保存设置
            </Button>
          </Form>
        </Card>
        <Card bordered={false}>
          <h2>本地处理引擎</h2>
          <div className="engine-facts">
            <div>
              <span>引擎版本</span>
              <strong>{data.version}</strong>
            </div>
            {Object.entries(data.tools).map(([name, available]) => (
              <div key={name}>
                <span>{name}</span>
                <Tag color={available ? "success" : "warning"}>
                  {available ? "可用" : "未安装"}
                </Tag>
              </div>
            ))}
            <p className="muted break-all">数据位置：{data.root}</p>
          </div>
          <Alert
            showIcon
            type="info"
            message="处理结果和质量报告保存在本机。仅在你安排发布或启用主页自动发帖时上传素材；AI 生成会向所配置接口发送文字资料。"
          />
        </Card>
      </div>
    </>
  );
}

function Workspace() {
  const { data, jobs, settings, error } = useStore();
  const location = useLocation();
  const [comparison, setComparison] = useState<Job | null>(null);
  const [report, setReport] = useState<Job | null>(null);
  const current = navigationEntries.find(
    (entry) => entry.path === location.pathname,
  );
  const active = jobs.filter((job) => !terminal(job)).length;
  const callbacks = { compare: setComparison, report: setReport };
  return (
    <ConfigProvider
      theme={{
        algorithm:
          settings.theme === "light"
            ? theme.defaultAlgorithm
            : theme.darkAlgorithm,
        token: {
          colorPrimary: "#64d5ba",
          colorInfo: "#64d5ba",
          colorSuccess: "#64d5ba",
          colorBgBase: settings.theme === "light" ? "#f4f6f5" : "#121719",
          colorBgContainer: settings.theme === "light" ? "#ffffff" : "#1a2124",
          colorBorder: settings.theme === "light" ? "#d7dedc" : "#364044",
          borderRadius: 9,
          fontSize: 14,
          fontFamily:
            '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            primaryColor: "#10251f",
            fontWeight: 600,
            controlHeight: 38,
          },
          Card: { paddingLG: 24 },
          Table: {
            headerBg: settings.theme === "light" ? "#eef2f0" : "#202a2e",
          },
        },
      }}
    >
      <div
        className={`desktop ${settings.theme} ${settings.reducedMotion ? "reduce-motion" : ""}`}
      >
        <Sidebar active={active} error={error} version={data.version} />
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              工作台 <span>/</span> <strong>{current?.label}</strong>
            </div>
            <Space>
              <span className="privacy-indicator">
                <CheckCircleOutlined /> 本地处理 · 自主发布
              </span>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  window.location.hash = "#/tools/queue";
                }}
              >
                {active ? `${active} 个后台任务` : "暂无后台任务"}
              </Button>
            </Space>
          </header>
          <main className="page-content">
            {error && (
              <Alert
                type="error"
                className="mb-5"
                message="Python 引擎已断开，请重新启动应用"
                description={error}
                showIcon
              />
            )}
            <Suspense
              fallback={
                <Spin tip="正在载入页面">
                  <div className="p-8" />
                </Spin>
              }
            >
              <Routes>
                <Route
                  path="/"
                  element={<Navigate to="/library/materials" replace />}
                />
                <Route
                  path="/workspace/process"
                  element={
                    <Process
                      key={`process-${settings.method}`}
                      {...callbacks}
                    />
                  }
                />
                <Route
                  path="/workspace/delivery"
                  element={
                    <Process key="delivery" deliveryOnly {...callbacks} />
                  }
                />
                <Route
                  path="/workspace/batch"
                  element={<Batch key={settings.method} {...callbacks} />}
                />
                <Route
                  path="/library/history"
                  element={<History {...callbacks} />}
                />
                <Route
                  path="/library/reports"
                  element={<Quality report={setReport} />}
                />
                <Route path="/library/corpus" element={<CorpusPage />} />
                <Route path="/library/materials" element={<Materials />} />
                <Route
                  path="/workspace/production"
                  element={<Production {...callbacks} />}
                />
                <Route
                  path="/publishing/posts"
                  element={<PostsPage {...callbacks} />}
                />
                <Route
                  path="/tools/copywriter"
                  element={<PostsPage supplemental {...callbacks} />}
                />
                <Route
                  path="/publishing/pages"
                  element={<AuthorizationsPage />}
                />
                <Route
                  path="/publishing/tasks"
                  element={<PublishTasksPage />}
                />
                <Route path="/tools/queue" element={<Queue {...callbacks} />} />
                <Route path="/tools/profiles" element={<Profiles />} />
                <Route
                  path="/tools/calibrate"
                  element={<Calibrate key="calibrate" />}
                />
                <Route
                  path="/tools/experiments"
                  element={<Calibrate key="variants" variants />}
                />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/settings/services"
                  element={<PublishingSettings />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
          <footer className="statusbar">
            <span>视频处理工作台</span>
            <span>
              本地运行 <i /> v{data.version}
            </span>
          </footer>
        </div>
      </div>
      <CompareModal job={comparison} onClose={() => setComparison(null)} />
      <ReportModal job={report} onClose={() => setReport(null)} />
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={zhCN}
    button={{ autoInsertSpace: false }}
    theme={{ algorithm: theme.darkAlgorithm }}
  >
    <AntApp>
      <StoreProvider>
        <HashRouter>
          <Workspace />
        </HashRouter>
      </StoreProvider>
    </AntApp>
  </ConfigProvider>,
);
