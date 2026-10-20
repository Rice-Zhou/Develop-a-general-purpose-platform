import { useEffect, useState } from "react";
import type {
  Task,
  TaskEvent,
  ContextSnapshot,
} from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
export function TaskDetails({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = unwrap(await window.platform.getTaskEvents(task.id));
        const snapshot = task.contextSnapshotId
          ? unwrap(await window.platform.getContext(task.contextSnapshotId))
          : null;
        if (alive) {
          setEvents(result);
          setContext(snapshot);
        }
      } catch (err) {
        if (alive) setError(message(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [task.id, task.updatedAt, task.contextSnapshotId]);
  return (
    <div className="modal-backdrop">
      <aside
        className="detail-panel modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">TASK DETAILS</span>
            <h2 id="task-title">
              {task.projectName} ·{" "}
              {["UPDATE_CODE", "CONTINUE_CODE_UPDATE", "RESOLVE_CODE_CONFLICTS"].includes(task.kind) ? "代码更新" : task.kind === "PREPARE_CONTEXT"
                ? "上下文准备"
                : task.kind === "EXTRACT_REQUIREMENTS"
                  ? "需求提取"
                  : task.kind === "ANALYZE_BUG"
                    ? "BUG 预分析"
                    : "实现核对"}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭任务详情"
          >
            ×
          </button>
        </div>
        <div className="detail-meta">
          <span>第 {task.attempt} 次尝试</span>
          <code>{task.id}</code>
        </div>
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        {task.error && (
          <div className="error-panel">
            <strong>{task.error.code}</strong>
            <p>{task.error.message}</p>
            {task.error.requiredAction && <p>{task.error.requiredAction}</p>}
          </div>
        )}
        <h3>执行记录</h3>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.sequence}>
              <span className="timeline-dot" />
              <div>
                <div className="timeline-meta">
                  <code>{event.stage}</code>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                </div>
                <p>{event.message}</p>
              </div>
            </li>
          ))}
        </ol>
        {context && (
          <>
            <h3>代码快照</h3>
            {context.repositories.map((repo) => (
              <div className="snapshot-card" key={repo.bindingId}>
                <div className="section-heading">
                  <strong>{repo.branch}</strong>
                  <span className="tag">{repo.files.length} 个文件</span>
                </div>
                <code className="commit">{repo.commit}</code>
                <p className="path">{repo.canonicalPath}</p>
                <p className="small muted">
                  获取于 {new Date(repo.fetchedAt).toLocaleString()}
                </p>
                {repo.excluded.length > 0 && (
                  <details>
                    <summary>排除 {repo.excluded.length} 个文件</summary>
                    <pre>{repo.excluded.join("\n")}</pre>
                  </details>
                )}
              </div>
            ))}
            {context.documents.length > 0 && (
              <>
                <h3>文档快照</h3>
                {context.documents.map((document) => (
                  <div className="snapshot-card" key={document.id}>
                    <strong>{document.kind.toUpperCase()}</strong>
                    <code className="commit">{document.contentHash}</code>
                    <p className="small muted">{document.id}</p>
                  </div>
                ))}
              </>
            )}
            <div className="notice">
              <strong>本次准备范围</strong>
              {context.limitations.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
