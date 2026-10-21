import { useEffect, useRef, useState } from "react";
import {
  evidenceLabel,
  type EvidenceRef,
} from "../../../../../packages/contracts/src/analysis";
import { message, unwrap } from "../api";
export function BugEvidenceItem({
  projectId,
  contextId,
  evidence,
  expanded = false,
  expandRequest = 0,
}: {
  projectId: string;
  contextId: string;
  evidence: EvidenceRef;
  expanded?: boolean;
  expandRequest?: number;
}) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [text, setText] = useState<string | null>(null),
    [error, setError] = useState("");
  const alive = useRef(true),
    reading = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function read() {
    if (reading.current || text !== null) return;
    reading.current = true;
    setLoading(true);
    setError("");
    try {
      const result = unwrap(
        await window.platform.readEvidence(projectId, contextId, evidence),
      );
      if (alive.current) setText(result.text);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      reading.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (expanded) {
      setOpen(true);
      void read();
    }
  }, [expanded, expandRequest]); // Report identity is the component key.
  return (
    <div className="bug-evidence-item" id={`bug-evidence-${evidence.id}`}>
      <div className="report-list-item">
        <code className="small">
          {evidence.id} · {evidenceLabel(evidence)}
        </code>
        <button
          className="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) void read();
          }}
        >
          {open ? "收起 BUG 证据" : "阅读 BUG 证据"}
        </button>
      </div>
      {open && (
        <div className="evidence-content">
          {loading && <p role="status">正在读取证据…</p>}
          {error && (
            <div className="error-panel" role="alert">
              {error}
              <button className="secondary" onClick={() => void read()}>
                重试读取证据
              </button>
            </div>
          )}
          {text !== null && (
            <pre className="code-preview">
              {text.length ? text : "（空片段）"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
