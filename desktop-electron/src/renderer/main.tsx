import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  App as AntApp,
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Form,
  Radio,
  Select,
  Space,
  Switch,
  Tag,
  theme,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ControlOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FolderOutlined,
  HistoryOutlined,
  PlaySquareOutlined,
  SettingOutlined,
  SlidersOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
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

const groups = [
  {
    title: "工作区",
    entries: [
      {
        path: "/workspace/process",
        label: "视频处理",
        icon: <PlaySquareOutlined />,
      },
      {
        path: "/workspace/batch",
        label: "批量处理",
        icon: <AppstoreOutlined />,
      },
      {
        path: "/workspace/delivery",
        label: "短剧制作",
        icon: <VideoCameraOutlined />,
      },
    ],
  },
  {
    title: "调优与质量",
    entries: [
      {
        path: "/tools/calibrate",
        label: "自动调参",
        icon: <SlidersOutlined />,
      },
      {
        path: "/library/reports",
        label: "质量报告",
        icon: <FileSearchOutlined />,
      },
      { path: "/tools/profiles", label: "处理配置", icon: <ControlOutlined /> },
    ],
  },
  {
    title: "素材库",
    entries: [
      {
        path: "/library/history",
        label: "历史记录",
        icon: <HistoryOutlined />,
      },
      {
        path: "/library/corpus",
        label: "参考素材库",
        icon: <FolderOutlined />,
      },
    ],
  },
  {
    title: "工具",
    entries: [
      {
        path: "/tools/queue",
        label: "处理队列",
        icon: <UnorderedListOutlined />,
      },
      {
        path: "/tools/experiments",
        label: "实验版本",
        icon: <ExperimentOutlined />,
      },
      { path: "/settings", label: "设置", icon: <SettingOutlined /> },
    ],
  },
];

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
            message="处理结果和质量报告均保存在本机。没有视频发布功能，也不会自动上传素材。"
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
  const entries = groups.flatMap((group) => group.entries);
  const current = entries.find((entry) => entry.path === location.pathname);
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
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-symbol">
              v<span>u</span>
            </span>
            <div>
              <strong>Video Uniquifier</strong>
              <small>本地视频工作台</small>
            </div>
          </div>
          <nav aria-label="主导航">
            {groups.map((group) => (
              <div className="nav-group" key={group.title}>
                <div className="nav-group-label">{group.title}</div>
                {group.entries.map((entry) => (
                  <NavLink
                    key={entry.path}
                    to={entry.path}
                    aria-label={entry.label}
                  >
                    {entry.icon}
                    <span>{entry.label}</span>
                    {entry.path === "/tools/queue" && active > 0 && (
                      <Badge count={active} color="#3b8c77" />
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className={`engine-dot ${error ? "offline" : ""}`} />
            <div>
              <strong>{error ? "引擎连接中断" : "本地引擎就绪"}</strong>
              <small>v{data.version} · 本地处理</small>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              工作台 <span>/</span> <strong>{current?.label}</strong>
            </div>
            <Space>
              <span className="privacy-indicator">
                <CheckCircleOutlined /> 素材保留在本机
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
            <Routes>
              <Route
                path="/"
                element={<Navigate to="/workspace/process" replace />}
              />
              <Route
                path="/workspace/process"
                element={
                  <Process key={`process-${settings.method}`} {...callbacks} />
                }
              />
              <Route
                path="/workspace/delivery"
                element={<Process key="delivery" deliveryOnly {...callbacks} />}
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
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
