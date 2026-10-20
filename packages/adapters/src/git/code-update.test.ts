import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepositoryAdapter } from "./repository";
import { git, gitFixture } from "../../../testkit/src/git-fixture";

it("updates code with rebase while preserving local commits and stops at conflicts", async () => {
  const f = await gitFixture();
  const adapter = new GitRepositoryAdapter();
  try {
    await writeFile(join(f.analysis, "local.txt"), "local\n");
    git(f.analysis, "add", "."); git(f.analysis, "commit", "-m", "local work");
    await f.publish("remote\n");
    await adapter.update(f.binding, new AbortController().signal);
    expect(git(f.analysis, "show", "HEAD:local.txt")).toBe("local");
    expect(git(f.analysis, "show", "HEAD:feature.txt")).toBe("remote");
    await writeFile(join(f.analysis, "feature.txt"), "local conflict\n");
    git(f.analysis, "add", "."); git(f.analysis, "commit", "-m", "conflict");
    await f.publish("remote conflict\n");
    await expect(adapter.update(f.binding, new AbortController().signal)).rejects.toMatchObject({ code: "GIT_REBASE_CONFLICT" });
    const original = await adapter.conflicts(f.binding, new AbortController().signal);
    expect(original.files.map(f => f.path)).toEqual(["feature.txt"]);
    await expect(adapter.applyConflicts(f.binding, original, [{ path: "../outside", content: "invalid" }], new AbortController().signal)).rejects.toMatchObject({ code: "CONFLICT_CHANGED" });
    await writeFile(join(f.analysis, "feature.txt"), "resolved\n"); git(f.analysis, "add", "feature.txt");
    await adapter.continueUpdate(f.binding, new AbortController().signal);
    expect(git(f.analysis, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(f.analysis, "show", "HEAD:feature.txt")).toBe("resolved");
  } finally { await f.dispose(); }
});

it("applies only unchanged conflict files and continues an AI resolution", async () => {
  const f = await gitFixture(); const adapter = new GitRepositoryAdapter();
  try {
    await writeFile(join(f.analysis, "feature.txt"), "ours\n"); git(f.analysis, "add", "."); git(f.analysis, "commit", "-m", "ours");
    await f.publish("theirs\n");
    await expect(adapter.update(f.binding, new AbortController().signal)).rejects.toMatchObject({ code: "GIT_REBASE_CONFLICT" });
    const original = await adapter.conflicts(f.binding, new AbortController().signal);
    await writeFile(join(f.analysis, "feature.txt"), "manual edit\n");
    await expect(adapter.applyConflicts(f.binding, original, [{ path: "feature.txt", content: "resolved" }], new AbortController().signal)).rejects.toMatchObject({ code: "CONFLICT_CHANGED" });
    await writeFile(join(f.analysis, "feature.txt"), original.files[0].content);
    await adapter.applyConflicts(f.binding, original, [{ path: "feature.txt", content: "resolved\n" }], new AbortController().signal);
    await adapter.continueUpdate(f.binding, new AbortController().signal);
    expect(git(f.analysis, "show", "HEAD:feature.txt")).toBe("resolved");
  } finally { await f.dispose(); }
});
