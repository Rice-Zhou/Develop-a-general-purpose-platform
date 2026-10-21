import { it, expect } from "vitest";
import { parseRequest } from "./ipc";
it("update IPC accepts offer IDs and rejects executable paths and URLs", () => {
  expect(parseRequest({ method: "getUpdateStatus", params: {} }).method).toBe(
    "getUpdateStatus",
  );
  expect(
    parseRequest({ method: "installUpdate", params: { offerId: "1:hash" } })
      .method,
  ).toBe("installUpdate");
  for (const params of [
    { offerId: "x", path: "C:/evil.exe" },
    { url: "https://evil.test" },
    { offerId: "" },
  ])
    expect(() => parseRequest({ method: "installUpdate", params })).toThrow();
});
