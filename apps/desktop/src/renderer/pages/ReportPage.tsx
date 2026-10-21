import { isCodeEvidence, evidenceLabel } from "../../../../../packages/contracts/src/analysis";
import { useState } from "react";
import type {
  AnalysisReport,
  EvidenceRef,
} from "../../../../../packages/contracts/src/analysis";
import type { RequirementItem } from "../../../../../packages/contracts/src/requirements";
import { unwrap, message } from "../api";
const labels = {
  IMPLEMENTED: "已实现",
  PARTIAL: "部分实现",
  MISSING: "缺失",
  UNKNOWN: "无法确认",
  CONFLICT: "需求冲突",
};
export function ReportPage({
  report,
  items,
  onClose,
}: {
  report: AnalysisReport;
  items: RequirementItem[];
  onClose: () => void;
}) {
  const [excerpt, setExcerpt] = useState<{
    text: string;
    evidence: EvidenceRef;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function read(ref: EvidenceRef) {
    setError("");
    setExcerpt(null);
    try {
      setExcerpt(
        unwrap(
          await window.platform.readEvidence(
            report.projectId,
            report.contextSnapshotId,
            ref,
          ),
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="panel work-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">EVIDENCE-BACKED REPORT</span>
          <h2>需求实现核对报告</h2>
        </div>
        <div className="row-actions">
          <button
            className="secondary"
            onClick={() =>
              void window.platform
                .exportReport(report.projectId, report.id)
                .then((result) => {
                  const path = unwrap(result);
                  if (path) setNotice(`已导出到 ${path}`);
                })
                .catch((e) => setError(message(e)))
            }
          >
            导出 Markdown
          </button>
          <button className="text-button" onClick={onClose}>
            返回需求工作台
          </button>
        </div>
      </div>
      <p className="muted">
        静态分析，未运行验证 · {new Date(report.createdAt).toLocaleString()}
      </p>
      <code className="report-context">上下文 {report.contextSnapshotId}</code>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {report.findings.map((finding) => (
        <article className="finding-card" key={finding.requirementId}>
          <div className="section-heading">
            <h3>
              {items.find((item) => item.id === finding.requirementId)?.text ??
                finding.requirementId}
            </h3>
            <span
              className={`finding-status finding-${finding.status.toLowerCase()}`}
            >
              {labels[finding.status]}
            </span>
          </div>
          <p>{finding.explanation}</p>
          <details>
            <summary>检查范围</summary>
            <ul>
              {finding.checkedScope.map((scope, index) => (
                <li key={index}>{scope}</li>
              ))}
            </ul>
          </details>
          <div className="evidence-links">
            {finding.evidenceIds.map((id) => {
              const ref = report.evidenceRefs.find((item) => item.id === id);
              return ref ? (
                <button
                  className="secondary"
                  key={id}
                  onClick={() => void read(ref)}
                >
                  {isCodeEvidence(ref) ? "阅读代码证据" : "阅读原文证据"}
                </button>
              ) : null;
            })}
          </div>
        </article>
      ))}
      {excerpt && (
        <div className="evidence-reader">
          <h3>固定版本证据</h3>
          <p className="muted small">
            {evidenceLabel(excerpt.evidence)}
          </p>
          <pre className="evidence-content">{excerpt.text}</pre>
        </div>
      )}
      <details className="coverage-warning">
        <summary>分析限制与未解析材料</summary>
        <ul>
          {report.limitations.map((limit, index) => (
            <li key={index}>{limit}</li>
          ))}
          {report.sourceGaps.map((gap, index) => (
            <li key={`gap-${index}`}>{gap.message}</li>
          ))}
          {report.parseWarnings.flatMap((source) =>
            source.warnings.map((warning, index) => (
              <li key={`${source.documentSnapshotId}-${index}`}>
                {warning.message}
              </li>
            )),
          )}
        </ul>
      </details>
      <p className="muted small">
        {report.executorConfiguration.name} ·{" "}
        {report.executorConfiguration.configuredModel ??
          "工具默认模型，具体模型未报告"}{" "}
        · {report.executorVersion} · {report.templateVersion} ·{" "}
        {report.usage
          ? `输入 ${report.usage.inputTokens} / 输出 ${report.usage.outputTokens} token`
          : "工具未提供可靠用量"}
      </p>
    </section>
  );
}
