import { expect, it } from "vitest";
import { trinityProtocol } from "./trinity-session";
import { readTrinityIdentity } from "./login";

it.each([false, true, null])("preserves the returned gray routing value including explicit null: %s", async isGray => {
  const data = { uid: "verified-user", apiVersion: "Trinity V7.5.0", isGray };
  expect(trinityProtocol(data)).toEqual({ apiVersion: data.apiVersion, isGray: String(isGray) });
  expect(await readTrinityIdentity("https://trinity.example", "token", (async () => Response.json({ code: 200, data })) as typeof fetch)).toEqual({ accountId: data.uid });
});

it.each([
  [{ isGray: false }, "apiVersion=missing"],
  [{ apiVersion: null, isGray: false }, "apiVersion=null"],
  [{ apiVersion: "", isGray: false }, "apiVersion=empty-string"],
  [{ apiVersion: "v7" }, "isGray=missing"],
  [{ apiVersion: 7.5, isGray: false }, "apiVersion=number"],
  [{ apiVersion: "v7", isGray: 0 }, "isGray=number"],
  [{ apiVersion: "v7", isGray: { token: "private-token" } }, "isGray=object"],
  [{ apiVersion: "v7", isGray: [] }, "isGray=array"],
  [{ apiVersion: "v7", isGray: "false\r\nX-Token: private-token" }, "isGray=invalid-string"],
])("rejects invalid protocol metadata and exposes only field shape: %j", (data, shape) => {
  expect(() => trinityProtocol(data)).toThrow(shape);
  expect(() => trinityProtocol(data)).not.toThrow(/private-token/);
});
