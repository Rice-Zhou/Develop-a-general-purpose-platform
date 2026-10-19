import { useState } from "react";
import type {
  DocumentSnapshot,
  DocumentBlock,
} from "../../../../../packages/contracts/src/documents";
import type {
  SearchResult,
  EvidenceRef,
} from "../../../../../packages/contracts/src/analysis";
import { unwrap, message } from "../api";
export function DocumentsPage({
  projectId,
  contextId,
  documents,
  onAdd,
}: {
  projectId: string;
  contextId: string;
  documents: DocumentSnapshot[];
  onAdd: (document: DocumentSnapshot, block: DocumentBlock) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [searching, setSearching] = useState(false);
  async function read(ref: EvidenceRef) {
    try {
      setError("");
      setExcerpt("");
      setExcerpt(
        unwrap(await window.platform.readEvidence(projectId, contextId, ref))
          .text,
      );
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="panel work-panel">
      <div className="section-heading">
        <h2>固定文档与证据检索</h2>
        <span className="tag">{documents.length} 份文档</span>
      </div>
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setSearching(true);
          void window.platform
            .searchEvidence(projectId, contextId, query)
            .then((response) => setResult(unwrap(response)))
            .catch((e) => setError(message(e)))
            .finally(() => setSearching(false));
        }}
      >
        <input
          aria-label="快照检索关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文档、代码和路径"
          required
        />
        <button className="secondary" disabled={searching}>
          搜索固定快照
        </button>
      </form>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="search-results">
          <p className="muted small">
            {result.method === "trigram" ? "Trigram 索引" : "短词有界扫描"} ·{" "}
            {result.results.length} 条，检索不代表全量语义覆盖
          </p>
          {result.results.map((row, index) => (
            <div className="search-result" key={index}>
              <pre>{row.text}</pre>
              {row.evidence ? (
                <button
                  className="text-button"
                  onClick={() => void read(row.evidence!)}
                >
                  阅读固定证据
                </button>
              ) : (
                <span className="muted small">
                  路径索引；尚未读取此文件内容
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {excerpt && <pre className="evidence-content">{excerpt}</pre>}
      {documents.length === 0 && (
        <p className="muted">
          当前上下文尚未包含文档。请在项目配置关联 Word、PDF
          或飞书链接，再准备上下文。
        </p>
      )}
      {documents.map((doc) => (
        <details className="document-card" key={doc.id} open>
          <summary>
            <strong>
              {doc.sourceLocator.split(/[\\/]/).at(-1) || doc.kind}
            </strong>
            <span className="tag">{doc.kind.toUpperCase()}</span>
          </summary>
          <div className="document-meta">
            <code>{doc.contentHash.slice(0, 16)}</code>
            <span>{new Date(doc.fetchedAt).toLocaleString()}</span>
            {doc.sourceRevision && <span>版本 {doc.sourceRevision}</span>}
          </div>
          {doc.warnings.length > 0 && (
            <div className="coverage-warning">
              <strong>解析提示</strong>
              {doc.warnings.map((warning, index) => (
                <p key={index}>{warning.message}</p>
              ))}
            </div>
          )}
          {doc.blocks.map((block) => (
            <div className="document-block" key={block.id}>
              <div className="block-heading">
                <span className="muted small">
                  {block.anchor.label}
                  {block.headingPath.length
                    ? " · " + block.headingPath.join(" / ")
                    : ""}
                </span>
                <button
                  className="text-button"
                  disabled={!block.text.trim()}
                  onClick={() => onAdd(doc, block)}
                >
                  加入需求
                </button>
              </div>
              {block.table ? (
                <div className="table-wrap">
                  <table>
                    <tbody>
                      {block.table.map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, column) => (
                            <td key={column}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p
                  className={
                    block.kind === "heading" ? "source-heading" : "source-text"
                  }
                >
                  {block.text || "此块没有可提取文本"}
                </p>
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}
