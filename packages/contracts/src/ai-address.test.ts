import { expect, it } from "vitest";
import { parseAIAddress } from "./ai-address";
import { AIProfileDraftSchema } from "./analysis";
it("stores canonical API and proxy addresses in the existing profile", () => {
  expect(AIProfileDraftSchema.parse({kind:"api",name:"AI",model:"model",outboundEnabled:true,baseUrl:"http://host:8080/v1",proxyUrl:"127.0.0.1:7897"})).toMatchObject({baseUrl:"host:8080/v1",proxyUrl:"127.0.0.1:7897"});
});
it("normalizes either scheme and preserves API paths and IPv6", () => {
  for (const input of ["host:8443/v1", "https://host:8443/v1/", "http://host:8443/v1"]) {
    expect(parseAIAddress(input, "api")).toEqual({ address: "host:8443/v1", httpsUrl: "https://host:8443/v1", httpUrl: "http://host:8443/v1" });
  }
  expect(parseAIAddress(" [::1]:7897 ", "proxy").httpUrl).toBe("http://[::1]:7897");
});
it("rejects ambiguous, credential bearing and non-address inputs", () => {
  for (const input of ["", "https://http://host", "u:p@host", "host/?key=x", "host/#x", "host/a b", "ftp://host", "host\\path"]) expect(() => parseAIAddress(input, "api")).toThrow();
  expect(() => parseAIAddress("host/proxy", "proxy")).toThrow();
});
