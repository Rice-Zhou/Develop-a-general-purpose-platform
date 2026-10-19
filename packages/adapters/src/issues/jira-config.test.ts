import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJiraServer } from "./jira-config";
it("reads only scalar server metadata and rejects ambiguous or excessive YAML without exposing content", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-config-"));
  const path = join(root, "config.yml");
  try {
    await writeFile(
      path,
      'server: "https://jira.example"\nprivate: fixture-private-value\n',
    );
    expect(await readJiraServer(path)).toBe("https://jira.example");
    for (const text of [
      "server: https://a.example\nserver: https://b.example\nprivate: fixture-private-value",
      "private: &key https://jira.example\nserver: *key",
      "private: [fixture-private-value",
      "x".repeat(1024 * 1024 + 1),
    ]) {
      await writeFile(path, text);
      const error = await readJiraServer(path).then(
        () => null,
        (e) => e as Error,
      );
      expect(error).not.toBeNull();
      expect(error?.message).not.toContain("fixture-private-value");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
