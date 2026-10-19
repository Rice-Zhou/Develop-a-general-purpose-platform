import { expect, it } from "vitest";
import { loginTrinity } from "./login";
import { curlFetch } from "../network/curl-fetch";
it("exchanges a Trinity password using the site's public cipher parameters without sending plaintext", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const request = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/"))
      return new Response("<script src=static/js/app.js></script>");
    if (String(url).endsWith(".js"))
      return new Response(
        'a=r.enc.Utf8.parse("0123456789abcdef"),b=r.enc.Utf8.parse("fedcba9876543210");function x(t){return r.AES.encrypt(t,a)}',
      );
    return Response.json({ code: 200, data: { token: "session-token" } });
  };
  expect(
    await loginTrinity(
      "https://trinity.example/trinity",
      "alice",
      "private-password",
      request,
    ),
  ).toBe("session-token");
  const login = requests.at(-1)!;
  expect(login.url).toBe("https://trinity.example/trinity/security/login/ldap");
  expect(String(login.init?.body)).not.toContain("private-password");
  expect(new URLSearchParams(String(login.init?.body)).get("uid")).toBe(
    "alice",
  );
  await expect(
    loginTrinity(
      "https://trinity.example/trinity",
      "alice",
      "private-password",
      async () => new Response("unsupported frontend"),
    ),
  ).rejects.toMatchObject({ code: "TRINITY_LOGIN_UNSUPPORTED" });
});
it("passes HTTP secrets only through curl stdin and disallows redirects", async () => {
  let args: string[] = [];
  let input = "";
  const response = await curlFetch(
    "https://trinity.example/trinity/test",
    {
      method: "POST",
      headers: { "X-Token": "secret-token" },
      body: "secret-body",
    },
    async (_exe, a, options) => {
      args = a;
      input = options.input!;
      return '{"ok":true}\n200';
    },
  );
  expect(await response.json()).toEqual({ ok: true });
  expect(args.join(" ")).not.toMatch(/secret-token|secret-body/);
  expect(input).toContain("secret-token");
  expect(args).not.toContain("--location");
  expect(args).toContain("--disable");
});
