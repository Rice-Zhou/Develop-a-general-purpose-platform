import { useCallback, useEffect, useState } from "react";
import type {
  AppInfo,
  Project,
  Task,
  TaskStatus,
} from "../../../../packages/contracts/src/models";
import { message, unwrap } from "./api";
import { ProjectEditor } from "./components/ProjectEditor";
import { TaskDetails } from "./components/TaskDetails";
import { RequirementsPage } from "./pages/RequirementsPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { IssueConnectionsPage } from "./pages/IssueConnectionsPage";
import { BugsPage } from "./pages/BugsPage";
const statusLabels: Record<TaskStatus, string> = {
  QUEUED: "排队中",
  PREPARING: "准备中",
  RUNNING: "分析中",
  VALIDATING: "校验中",
  SUCCEEDED: "已完成",
  WAITING_INPUT: "等待处理",
  FAILED: "执行失败",
  CANCELLING: "正在取消",
  CANCELLED: "已取消",
  INTERRUPTED: "运行中断",
};
type Page =
  | "overview"
  | "projects"
  | "tasks"
  | "requirements"
  | "bugs"
  | "settings";
const nav: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "总览", icon: "◫" },
  { id: "projects", label: "项目管理", icon: "▦" },
  { id: "tasks", label: "任务历史", icon: "◷" },
  { id: "requirements", label: "需求核对", icon: "≡" },
  { id: "bugs", label: "BUG 工作台", icon: "◇" },
  { id: "settings", label: "设置", icon: "⚙" },
];
export function App() {
  const [page, setPage] = useState<Page>("overview");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [setupProject, setSetupProject] = useState<Project | null>(null);
  const [focusAISettings, setFocusAISettings] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  useEffect(() => {
    if (page !== "settings" || !focusAISettings) return;
    const target = document.getElementById("ai-connections-settings");
    if (target) {
      target.focus();
      target.scrollIntoView({ block: "start" });
      setFocusAISettings(false);
    }
  }, [page, focusAISettings]);
  const reload = useCallback(async () => {
    const [p, t] = await Promise.all([
      window.platform.listProjects(),
      window.platform.listTasks(),
    ]);
    setProjects(unwrap(p));
    setTasks(unwrap(t));
  }, []);
  useEffect(() => {
    if (!window.platform) {
      setError("桌面通信桥未加载，请通过 Electron 启动应用");
      return;
    }
    let alive = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const [p, t] = await Promise.all([
          window.platform.listProjects(),
          window.platform.listTasks(),
        ]);
        if (alive) {
          setProjects(unwrap(p));
          setTasks(unwrap(t));
        }
      } catch (err) {
        if (alive) setError(message(err));
      } finally {
        polling = false;
      }
    };
    void poll();
    void window.platform
      .getAppInfo()
      .then((result) => {
        if (alive) setInfo(unwrap(result));
      })
      .catch((err) => {
        if (alive) setError(message(err));
      });
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function act(action: () => Promise<unknown>) {
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
    } catch (err) {
      setError(message(err));
    }
  }
  async function prepare(projectId: string) {
    await act(async () => {
      unwrap(await window.platform.prepareContext(projectId));
      setPage("tasks");
      setProjectFilter(projectId);
    });
  }
  const running = tasks.filter((task) =>
    ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CANCELLING"].includes(
      task.status,
    ),
  );
  const attention = tasks.filter((task) =>
    ["WAITING_INPUT", "FAILED", "INTERRUPTED"].includes(task.status),
  );
  const activeTask = tasks.find((task) => task.id === selectedTask);
  const displayedTasks = tasks.filter(
    (task) => !projectFilter || task.projectId === projectFilter,
  );
  function taskTable(rows: Task[]) {
    return rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目 / 任务</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.projectName}</strong>
                  <span className="table-sub">
                    {task.kind === "PREPARE_CONTEXT"
                      ? "上下文准备"
                      : task.kind === "EXTRACT_REQUIREMENTS"
                        ? "需求提取"
                        : "实现核对"}{" "}
                    · 尝试 {task.attempt}
                  </span>
                </td>
                <td>
                  <span
                    className={`status status-${task.status.toLowerCase()}`}
                  >
                    {statusLabels[task.status]}
                  </span>
                </td>
                <td className="muted small">
                  {new Date(task.createdAt).toLocaleString()}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => setSelectedTask(task.id)}
                    >
                      查看详情
                    </button>
                    {["QUEUED", "PREPARING", "RUNNING", "VALIDATING"].includes(
                      task.status,
                    ) && (
                      <button
                        className="text-button danger-text"
                        onClick={() =>
                          void act(async () =>
                            unwrap(await window.platform.cancelTask(task.id)),
                          )
                        }
                      >
                        取消
                      </button>
                    )}
                    {[
                      "FAILED",
                      "WAITING_INPUT",
                      "CANCELLED",
                      "INTERRUPTED",
                    ].includes(task.status) && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void act(async () =>
                            unwrap(await window.platform.retryTask(task.id)),
                          )
                        }
                      >
                        重试
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty-small">
        暂无任务。选择项目后，可更新代码并准备分析上下文。
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">⌘</div>
          <div>
            <strong>研序</strong>
            <span>LOCAL DEV PLATFORM</span>
          </div>
        </div>
        <div className="workspace-label">个人研发空间</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.id === "tasks" && running.length > 0 && (
                <span className="nav-count">{running.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" />
          <div>
            本地运行<span>资料与任务保存在本机</span>
          </div>
          <span className="version">v{info?.version ?? "0.1"}</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">工作空间</span>
            <span className="crumb-divider">/</span>
            <strong>{nav.find((item) => item.id === page)?.label}</strong>
          </div>
          <div className="header-status">
            <span className={`local-dot ${error ? "warning-dot" : ""}`} />
            {error ? "需要处理" : "独立分析目录"}
            <span className="avatar">我</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview"
                  ? "YOUR DEVELOPMENT WORKSPACE"
                  : "LOCAL DEVELOPMENT"}
              </span>
              <h1>
                {page === "overview"
                  ? "研发工作台"
                  : nav.find((item) => item.id === page)?.label}
              </h1>
              <p className="muted">
                {page === "overview"
                  ? "让项目、资料和分析过程，保持在同一个上下文中。"
                  : page === "projects"
                    ? "每个项目使用独立的代码分析目录，按配置分支更新。"
                    : page === "tasks"
                      ? "查看每次准备的阶段、提交版本和需要处理的问题。"
                      : "连接项目资料，逐步建立可追溯的研发分析流程。"}
              </p>
            </div>
            {(page === "overview" || page === "projects") && (
              <button className="primary" onClick={() => setEditor("new")}>
                <span aria-hidden="true">＋ </span>添加项目
              </button>
            )}
          </div>
          {error && (
            <div className="error-panel global-error" role="alert">
              <span>{error}</span>
              <button className="text-button" onClick={() => setError("")}>
                收起
              </button>
            </div>
          )}
          {notice && <div className="notice">{notice}</div>}
          {page === "overview" && (
            <>
              <div className="stat-grid">
                {[
                  {
                    label: "参与项目",
                    value: projects.filter((p) => p.enabled).length,
                    sub: `${projects.length} 个项目已配置`,
                    icon: "▦",
                  },
                  {
                    label: "运行与排队",
                    value: running.length,
                    sub: "按项目安全准备代码",
                    icon: "◷",
                  },
                  {
                    label: "需要处理",
                    value: attention.length,
                    sub: "同步异常与中断任务",
                    icon: "◇",
                  },
                  {
                    label: "已固定快照",
                    value: tasks.filter((t) => t.status === "SUCCEEDED").length,
                    sub: "保留实际提交与获取时间",
                    icon: "⌁",
                  },
                ].map((stat) => (
                  <section className="stat-card" key={stat.label}>
                    <div className="stat-title">
                      {stat.label}
                      <span>{stat.icon}</span>
                    </div>
                    <strong>{stat.value}</strong>
                    <p>{stat.sub}</p>
                  </section>
                ))}
              </div>
              {projects.length === 0 ? (
                <section className="welcome-card">
                  <div className="welcome-illustration">
                    <div className="code-symbol">&lt; / &gt;</div>
                    <span className="illustration-dot one" />
                    <span className="illustration-dot two" />
                  </div>
                  <div>
                    <span className="tag">从一个项目开始</span>
                    <h2>为代码分析建立可靠的起点</h2>
                    <p>
                      关联本地独立代码目录和分支，平台会在每次准备前同步代码，
                      <br />
                      记录固定提交，为后续需求核对与 BUG 预分析提供依据。
                    </p>
                    <button
                      className="primary"
                      onClick={() => setEditor("new")}
                    >
                      配置第一个项目 <span>→</span>
                    </button>
                  </div>
                </section>
              ) : (
                <section className="panel">
                  <div className="section-heading padded">
                    <h2>
                      我的项目 <span className="count">{projects.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("projects")}
                    >
                      管理项目 →
                    </button>
                  </div>
                  <div className="project-overview">
                    {projects.map((project) => (
                      <button
                        className="project-mini"
                        key={project.id}
                        onClick={() => {
                          setPage("projects");
                        }}
                      >
                        <span className="project-avatar">
                          {project.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{project.name}</strong>
                          <p>
                            {project.repositories.length} 个代码仓库 ·{" "}
                            {project.documents.length} 份文档
                          </p>
                        </div>
                        <span className="muted">→</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="panel">
                <div className="section-heading padded">
                  <h2>最近任务</h2>
                  <button
                    className="text-button"
                    onClick={() => {
                      setProjectFilter("");
                      setPage("tasks");
                    }}
                  >
                    查看全部 →
                  </button>
                </div>
                {taskTable(tasks.slice(0, 5))}
              </section>
              <div className="phase-note">
                <span>03 / 问题闭环</span>
                <p>
                  已提供文档需求核对与 BUG 手动预分析。Jira 使用 CLI，Trinity
                  支持按编号读取；真实实例需配置验证，定时监控仍待接入。
                </p>
              </div>
            </>
          )}
          {page === "projects" && (
            <div className="project-grid">
              {projects.length === 0 && (
                <section className="empty-card">
                  <h2>还没有项目</h2>
                  <p>添加你参与的项目，并配置对应的独立分析目录。</p>
                </section>
              )}
              {projects.map((project) => (
                <section className="project-card" key={project.id}>
                  <div className="section-heading">
                    <div className="project-title">
                      <span className="project-avatar">
                        {project.name.slice(0, 1)}
                      </span>
                      <div>
                        <h2>{project.name}</h2>
                        <span className="small muted">
                          配置版本 {project.revision}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`status ${project.enabled ? "status-succeeded" : "status-cancelled"}`}
                    >
                      {project.enabled ? "已启用" : "已停用"}
                    </span>
                  </div>
                  {project.repositories.map((repo) => (
                    <div className="repository-row" key={repo.id}>
                      <div className="section-heading">
                        <strong>{repo.role || "代码仓库"}</strong>
                        <span className="branch-tag">⑂ {repo.branch}</span>
                      </div>
                      <p className="path">{repo.canonicalPath}</p>
                      <span className="small muted">
                        远端 {repo.remoteName}
                      </span>
                    </div>
                  ))}
                  <div className="project-resources">
                    <span>{project.documents.length} 份需求文档</span>
                    <span>{project.issueBindings.length} 条 BUG 范围</span>
                  </div>
                  <div className="project-footer">
                    <button
                      className="secondary"
                      onClick={() => setEditor(project)}
                    >
                      编辑配置
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !project.enabled ||
                        running.some((task) => task.projectId === project.id)
                      }
                      onClick={() => void prepare(project.id)}
                    >
                      更新并准备上下文
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}
          {page === "tasks" && (
            <section className="panel">
              <div className="section-heading padded">
                <h2>
                  任务记录{" "}
                  <span className="count">{displayedTasks.length}</span>
                </h2>
                <label className="filter-label">
                  项目筛选
                  <select
                    value={projectFilter}
                    onChange={(event) => setProjectFilter(event.target.value)}
                  >
                    <option value="">全部项目</option>
                    {projects.map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {taskTable(displayedTasks)}
            </section>
          )}
          {page === "requirements" && (
            <RequirementsPage
              projects={projects}
              tasks={tasks}
              onChanged={reload}
            />
          )}
          {page === "bugs" && (
            <BugsPage projects={projects} tasks={tasks} onChanged={reload} />
          )}
          {page === "settings" && (
            <>
              <IssueConnectionsPage />
              <div id="ai-connections-settings" tabIndex={-1}>
                <ConnectionsPage
                  onChanged={() =>
                    void window.platform
                      .getAppInfo()
                      .then((value) => setInfo(unwrap(value)))
                      .catch((error) => setError(message(error)))
                  }
                />
              </div>
              <section className="panel settings-panel">
                <h2>本地环境</h2>
                <dl>
                  <dt>应用版本</dt>
                  <dd>{info?.version ?? "正在读取"}</dd>
                  <dt>Git</dt>
                  <dd>
                    {info
                      ? info.gitAvailable
                        ? "可用"
                        : "未找到，请安装 Git 并重启应用"
                      : "正在检查"}
                  </dd>
                  <dt>数据位置</dt>
                  <dd className="path">{info?.dataPath ?? "正在读取"}</dd>
                  <dt>运行方式</dt>
                  <dd>关闭窗口进入托盘；明确退出后停止后台任务。</dd>
                </dl>
                <button
                  className="secondary"
                  onClick={() =>
                    void act(async () => {
                      const path = unwrap(
                        await window.platform.backupDatabase(),
                      );
                      if (path) setNotice(`数据库已备份到：${path}`);
                    })
                  }
                >
                  备份本地数据库
                </button>
              </section>
              <section className="panel settings-panel">
                <h2>能力状态</h2>
                {info?.capabilities.map((capability) => (
                  <div className="capability-row" key={capability.name}>
                    <div>
                      <strong>{capability.name}</strong>
                      <p>{capability.reason}</p>
                    </div>
                    <span
                      className={`status ${capability.available ? "status-succeeded" : "status-cancelled"}`}
                    >
                      {capability.available ? "可用" : "后续阶段"}
                    </span>
                  </div>
                ))}
              </section>
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>LOCAL FIRST · EVIDENCE BASED</span>
          <span>每次准备，都对应一个明确的代码版本。</span>
        </footer>
      </div>
      {editor && (
        <ProjectEditor
          project={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            if (editor === "new") setSetupProject(saved);
            setEditor(null);
            void act(reload);
          }}
        />
      )}
      {setupProject && (
        <div className="modal-backdrop">
          <section
            className="editor modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-ai-setup-title"
          >
            <h2 id="bug-ai-setup-title">配置 BUG AI 预分析</h2>
            <p>
              项目“{setupProject.name}”已保存。现在配置 AI
              连接，之后可在项目中关联并手动发起 BUG 预分析。
            </p>
            <div className="form-footer">
              <button
                className="secondary"
                autoFocus
                onClick={() => setSetupProject(null)}
              >
                暂时跳过
              </button>
              <button
                className="primary"
                onClick={() => {
                  setSetupProject(null);
                  setPage("settings");
                  setFocusAISettings(true);
                }}
              >
                去配置
              </button>
            </div>
          </section>
        </div>
      )}
      {activeTask && (
        <TaskDetails task={activeTask} onClose={() => setSelectedTask(null)} />
      )}
    </div>
  );
}
