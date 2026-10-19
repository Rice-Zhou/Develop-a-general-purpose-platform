import { describe, expect, it } from "vitest";
import { parseRequest, assertTrustedSender } from "./ipc";

describe("IPC contract", () => {
  it("accepts only scoped BUG methods without arbitrary command options", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const issueSnapshotId = "22222222-2222-4222-8222-222222222222";
    expect(
      parseRequest({
        method: "analyzeBug",
        params: { projectId, issueSnapshotId },
      }).method,
    ).toBe("analyzeBug");
    expect(() =>
      parseRequest({
        method: "refreshIssues",
        params: { projectId, bindingId: "b", jql: "project IS NOT EMPTY" },
      }),
    ).toThrow();
  });
  it("rejects unregistered methods and unknown payload fields", () => {
    expect(() =>
      parseRequest({ method: "shell", params: { command: "whoami" } }),
    ).toThrow();
    expect(() =>
      parseRequest({ method: "listProjects", params: { path: "C:/" } }),
    ).toThrow();
    expect(() =>
      parseRequest({
        method: "prepareContext",
        params: { projectId: "../other" },
      }),
    ).toThrow();
  });
  it("accepts a registered request without system capabilities", () => {
    expect(parseRequest({ method: "listProjects", params: {} }).method).toBe(
      "listProjects",
    );
  });
  it("rejects a sender from a different window or nested frame", () => {
    expect(() => assertTrustedSender(2, 1, true)).toThrow();
    expect(() => assertTrustedSender(1, 1, false)).toThrow();
    expect(() => assertTrustedSender(1, 1, true)).not.toThrow();
  });
});
