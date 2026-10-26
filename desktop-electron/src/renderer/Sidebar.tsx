import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Badge, Button, Tooltip } from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  ControlOutlined,
  DownOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FolderOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlaySquareOutlined,
  SafetyOutlined,
  SendOutlined,
  SettingOutlined,
  SlidersOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";

const groups = [
  {
    title: "工作区",
    entries: [
      { path: "/library/materials", label: "素材库", icon: <FolderOutlined /> },
      {
        path: "/workspace/production",
        label: "批量制作",
        icon: <VideoCameraOutlined />,
      },
      { path: "/publishing/posts", label: "内容库", icon: <EditOutlined /> },
    ],
  },
  {
    title: "视频工具",
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
    title: "发布管理",
    entries: [
      {
        path: "/publishing/pages",
        label: "主页授权",
        icon: <SafetyOutlined />,
      },
      { path: "/publishing/tasks", label: "发布任务", icon: <SendOutlined /> },
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
    title: "处理记录",
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
      { path: "/tools/copywriter", label: "文案工具", icon: <EditOutlined /> },
    ],
  },
];
const preferences = [
  { path: "/settings/services", label: "服务配置", icon: <ApiOutlined /> },
  { path: "/settings", label: "设置", icon: <SettingOutlined /> },
];
export const navigationEntries = [
  ...groups.flatMap((group) => group.entries),
  ...preferences,
];
const storageKey = "video-uniquifier.navigation.v1";
function readNavigation() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      saved &&
      typeof saved.collapsed === "boolean" &&
      Array.isArray(saved.closed) &&
      saved.closed.every((item: unknown) => typeof item === "string")
    )
      return saved as { collapsed: boolean; closed: string[] };
  } catch {
    /* Navigation remains usable when local storage is unavailable. */
  }
  return {
    collapsed: false,
    closed: ["视频工具", "调优与质量", "处理记录", "工具"],
  };
}

export default function Sidebar({
  active,
  error,
  version,
}: {
  active: number;
  error: string;
  version: string;
}) {
  const location = useLocation();
  const [navigation, setNavigation] = useState(readNavigation);
  const { collapsed, closed } = navigation;
  useEffect(() => {
    const current = groups.find((group) =>
      group.entries.some((entry) => entry.path === location.pathname),
    );
    if (current)
      setNavigation((value) =>
        value.closed.includes(current.title)
          ? {
              ...value,
              closed: value.closed.filter((title) => title !== current.title),
            }
          : value,
      );
  }, [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(navigation));
    } catch {
      /* Keep in-memory preferences. */
    }
  }, [navigation]);
  const link = (entry: (typeof navigationEntries)[number]) => (
    <Tooltip
      key={entry.path}
      title={collapsed ? entry.label : undefined}
      placement="right"
    >
      <NavLink to={entry.path} end aria-label={entry.label}>
        <span className="nav-icon" aria-hidden="true">
          {entry.icon}
        </span>
        <span className="nav-link-label">{entry.label}</span>
        {entry.path === "/tools/queue" && active > 0 && (
          <Badge count={active} color="#3b8c77" />
        )}
      </NavLink>
    </Tooltip>
  );
  return (
    <aside
      className={`sidebar ${collapsed ? "is-collapsed" : ""}`}
      aria-label="侧栏"
    >
      <div className="brand">
        <span className="brand-symbol" aria-hidden="true">
          v<span>u</span>
        </span>
        <div className="brand-copy">
          <strong>Video Uniquifier</strong>
          <small>本地视频工作台</small>
        </div>
      </div>
      <div className="nav-heading">
        <span>工作台导航</span>
        <Tooltip title={collapsed ? "展开侧栏" : "收起侧栏"} placement="right">
          <Button
            type="text"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            icon={
              collapsed ? (
                <MenuUnfoldOutlined aria-hidden="true" />
              ) : (
                <MenuFoldOutlined aria-hidden="true" />
              )
            }
            onClick={() =>
              setNavigation((value) => ({
                ...value,
                collapsed: !value.collapsed,
              }))
            }
          />
        </Tooltip>
      </div>
      <nav aria-label="主导航">
        {groups.map((group, index) => {
          const expanded = !closed.includes(group.title);
          return (
            <section className="nav-group" key={group.title}>
              <button
                className="nav-group-trigger"
                aria-expanded={expanded}
                aria-controls={`navigation-group-${index}`}
                onClick={() =>
                  setNavigation((value) => ({
                    ...value,
                    closed: expanded
                      ? [...value.closed, group.title]
                      : value.closed.filter((title) => title !== group.title),
                  }))
                }
              >
                <span>{group.title}</span>
                <DownOutlined aria-hidden="true" />
              </button>
              <div
                id={`navigation-group-${index}`}
                hidden={!collapsed && !expanded}
              >
                {group.entries.map(link)}
              </div>
            </section>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <nav className="preference-links" aria-label="配置与偏好">
          {preferences.map(link)}
        </nav>
        <div
          className="sidebar-bottom"
          title={error ? "引擎连接中断" : `本地引擎就绪 · v${version}`}
        >
          <span className={`engine-dot ${error ? "offline" : ""}`} />
          <div className="engine-copy">
            <strong>{error ? "引擎连接中断" : "本地引擎就绪"}</strong>
            <small>v{version} · 本地处理</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
