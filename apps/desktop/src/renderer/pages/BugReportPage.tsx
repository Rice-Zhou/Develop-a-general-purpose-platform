import { evidenceLabel } from "../../../../../packages/contracts/src/analysis";
import { useState } from "react";
import type {
  BugReport,
  IssueSnapshot,
} from "../../../../../packages/contracts/src/issues";
import type { ContextSnapshot } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
export function BugReportPage({
  report: r,
  issue,
  context,
  onClose,
}: {
  report: BugReport;
  issue: IssueSnapshot;
  context: ContextSnapshot;
  onClose: () => void;
}) {
  const [excerpt, setExcerpt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section className="panel work-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">BUG PREANALYSIS</span>
          <h2>BUG 预分析报告</h2>
        </div>
        <div className="row-actions">
          <button
            className="secondary"
            onClick={() =>
              void window.platform
                .exportBugReport(r.projectId, r.id)
                .then((v) => {
                  const path = unwrap(v);
                  if (path) setNotice(`已导出到 ${path}`);
                })
                .catch((e) => setError(message(e)))
            }
          >
            导出 BUG Markdown
          </button>
          <button className="text-button" onClick={onClose}>
            返回 BUG 工作台
          </button>
        </div>
      </div>
      <h3>
        {issue.key} · {issue.title}
      </h3>
      <p className="coverage-warning">
        静态预分析，未运行验证，候选原因未确认为根因。
      </p>
      <p className="muted">
        故障版本：{issue.versions.join("、") || "未提供"} · 问题快照{" "}
        {issue.id.slice(0, 8)} · {issue.updatedAt}
      </p>
      {context.repositories.map((repo) => (
        <p key={repo.bindingId} className="small">
          分析代码：{repo.branch} @ <code>{repo.commit}</code>
        </p>
      ))}
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <h3>复现条件</h3>
      <ul>
        {r.reproduction.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>代码事实</h3>
      {r.facts.length ? (
        r.facts.map((f, i) => (
          <p key={i}>
            {f.text}
            <br />
            <small>{f.evidenceIds.join("、")}</small>
          </p>
        ))
      ) : (
        <p className="muted">尚未取得充分代码事实。</p>
      )}
      <h3>候选原因与排查步骤</h3>
      {r.hypotheses.map((h, i) => (
        <article className="finding-card" key={i}>
          <strong>{h.text}</strong>
          <p className="small">
            支持证据：{h.supportEvidenceIds.join("、") || "未取得"}
            <br />
            反对证据：
            {h.counterEvidenceIds.join("、") || "尚未取得，不代表无反例"}
          </p>
          <ol>
            {h.nextSteps.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ol>
        </article>
      ))}
      <h3>缺失信息</h3>
      <ul>
        {r.missingInformation.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <h3>固定版本证据</h3>
      {r.evidenceRefs.map((e) => (
        <div className="report-list-item" key={e.id}>
          <code className="small">
            {evidenceLabel(e)}
          </code>
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setExcerpt("");
              void window.platform
                .readEvidence(r.projectId, r.contextSnapshotId, e)
                .then((v) => setExcerpt(unwrap(v).text))
                .catch((e) => setError(message(e)));
            }}
          >
            阅读 BUG 证据
          </button>
        </div>
      ))}
      {excerpt && <pre className="code-preview">{excerpt}</pre>}
      <details>
        <summary>检查范围与未解析材料</summary>
        <ul>
          {[...r.checkedScope, ...r.limitations].map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </details>
      <p className="muted small">
        {r.executorConfiguration.name} ·{" "}
        {r.executorConfiguration.configuredModel ?? "CLI 默认模型"} ·{" "}
        {r.usage
          ? `输入 ${r.usage.inputTokens} / 输出 ${r.usage.outputTokens} token`
          : "用量未知"}
      </p>
    </section>
  );
}
