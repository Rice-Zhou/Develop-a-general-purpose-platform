import { useEffect, useState } from "react";
import { message, unwrap } from "../api";

export function RepositoryBranchField({
  path,
  branch,
  id,
  onChange,
}: {
  path: string;
  branch: string;
  id: string;
  onChange: (branch: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    branch: string | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!path.trim()) return;
    const timer = setTimeout(() => {
      void window.platform
        .readCurrentBranch(path)
        .then((response) => {
          const current = unwrap(response);
          if (active) setResult({ path, branch: current.branch, error: "" });
        })
        .catch((error) => {
          if (active) setResult({ path, branch: null, error: message(error) });
        });
    }, 400);
    // A previous path's response must never populate this repository's branch.
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path, refresh]);
  const current = result?.path === path ? result : null;
  return (
    <div className="grow">
      <label htmlFor={id}>分析分支</label>
      <input
        id={id}
        required
        value={branch}
        onChange={(event) => onChange(event.target.value)}
        placeholder="确认当前分支，或输入其他分支"
      />
      <div className="input-action">
        <span className="muted small" aria-live="polite">
          {!path.trim()
            ? "选择分析目录后读取当前分支"
            : !current
              ? "正在读取当前分支…"
              : current.error
                ? "当前分支读取失败"
                : current.branch === null
                  ? "当前为 detached HEAD，请手动配置分支"
                  : `当前分支：${current.branch}`}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={!path.trim()}
          onClick={() => {
            setResult(null);
            setRefresh((value) => value + 1);
          }}
        >
          重新读取
        </button>
        {current?.branch && !current.error && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(current.branch!)}
          >
            使用当前分支
          </button>
        )}
      </div>
      {current?.error && (
        <p className="error-panel" role="alert">
          {current.error}
        </p>
      )}
      {current?.branch && branch && current.branch !== branch && (
        <p className="muted small">
          配置分支与当前分支不一致；分析前请自行切换，平台不会自动切换。
        </p>
      )}
    </div>
  );
}
