import { describe, expect, it } from "vitest";
import { parseRequest, assertTrustedSender } from "./ipc";

describe("IPC contract", () => {
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
