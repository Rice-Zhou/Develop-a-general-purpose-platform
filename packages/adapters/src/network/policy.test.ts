import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { runProcess } from "../process/run-process";
import { runGit } from "../git/git-process";
import { gitFixture, git } from "../../../testkit/src/git-fixture";
import { ChatCompletionsTransport } from "../ai/chat-completions";
import { SubscriptionTransport } from "../ai/subscription";
import { AIProfileDraftSchema } from "../../../contracts/src/analysis";
import { directEnvironment, fetchDirect } from "./policy";
import { getGlobalDispatcher } from "undici";

afterEach(() => vi.unstubAllEnvs());
async function listen(server: Server) {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}
const apiProfile = {
  kind: "api" as const,
  id: "test",
  name: "test",
  model: "test",
  outboundEnabled: true,
  credentialRef: null,
};

it("ordinary CLI removes inherited proxies while retaining unrelated environment", async () => {
  vi.stubEnv("hTtP_pRoXy", "http://127.0.0.1:1");
  vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:1");
  vi.stubEnv("NODE_USE_ENV_PROXY", "1");
  vi.stubEnv("NETWORK_TEST_VALUE", "preserved");
  const env = JSON.parse(
    await runProcess(
      process.execPath,
      ["-e", "console.log(JSON.stringify(process.env))"],
      { cwd: process.cwd() },
    ),
  );
  expect(env.hTtP_pRoXy).toBeUndefined();
  expect(env.HTTPS_PROXY).toBeUndefined();
  expect(env.NODE_USE_ENV_PROXY).toBe("0");
  expect(env.NO_PROXY).toBe("*");
  expect(env.NETWORK_TEST_VALUE).toBe("preserved");
});

it("direct policy removes every case of proxy variables without mutating the source", async () => {
  const source = {
    HTTP_PROXY: "a",
    https_proxy: "b",
    aLl_PrOxY: "c",
    nO_pRoXy: "d",
    node_use_env_proxy: "1",
    KEEP: "value",
  };
  expect(directEnvironment(source)).toEqual({
    KEEP: "value",
    NO_PROXY: "*",
    NODE_USE_ENV_PROXY: "0",
  });
  expect(source.HTTP_PROXY).toBe("a");
  const endpoint = await listen(createServer((_req, res) => res.end("direct")));
  const dispatcher = getGlobalDispatcher();
  try {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:1");
    expect(await (await fetchDirect(endpoint.url)).text()).toBe("direct");
    expect(getGlobalDispatcher()).toBe(dispatcher);
  } finally {
    await endpoint.close();
  }
});

it("Git fetch overrides environment, http proxy and named remote proxy without rewriting config", async () => {
  const fixture = await gitFixture();
  const paths: string[] = [];
  const endpoint = await listen(
    createServer((req, res) => {
      paths.push(req.url!);
      res.statusCode = 404;
      res.end();
    }),
  );
  try {
    git(
      fixture.analysis,
      "remote",
      "set-url",
      "origin",
      endpoint.url + "/repo",
    );
    git(fixture.analysis, "config", "http.proxy", "http://127.0.0.1:1");
    git(
      fixture.analysis,
      "config",
      "remote.origin.proxy",
      "http://127.0.0.1:2",
    );
    git(
      fixture.analysis,
      "config",
      `http.${endpoint.url}.proxy`,
      "http://127.0.0.1:4",
    );
    vi.stubEnv("ALL_PROXY", "http://127.0.0.1:3");
    vi.stubEnv("NO_PROXY", "");
    await expect(
      runGit(fixture.analysis, ["fetch", "origin"], AbortSignal.timeout(5000)),
    ).rejects.toMatchObject({ code: "GIT_FAILED" });
    expect(paths).toContain("/repo/info/refs?service=git-upload-pack");
    expect(git(fixture.analysis, "config", "remote.origin.proxy")).toBe(
      "http://127.0.0.1:2",
    );
    expect(git(fixture.analysis, "config", "http.proxy")).toBe(
      "http://127.0.0.1:1",
    );
    expect(git(fixture.analysis, "config", `http.${endpoint.url}.proxy`)).toBe(
      "http://127.0.0.1:4",
    );
  } finally {
    await endpoint.close();
    await fixture.dispose();
  }
});

it("AI explicit proxy uses CONNECT and a subsequent legacy connection goes direct", async () => {
  let connects = 0;
  let requests = 0;
  const endpoint = await listen(
    createServer((_req, res) => {
      requests++;
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }),
  );
  const proxyServer = createServer((_req,res)=>res.writeHead(400).end());
  proxyServer.on("connect", (req, client, head) => {
    connects++;
    const target = new URL(`http://${req.url}`);
    const upstream = connect(Number(target.port), target.hostname, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  const proxy = await listen(proxyServer);
  try {
    const dispatcher = getGlobalDispatcher();
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:1");
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:1");
    const configured = {
      ...apiProfile,
      baseUrl: endpoint.url,
      proxyUrl: proxy.url,
    };
    expect(
      (
        await new ChatCompletionsTransport(
          configured,
          async () => null,
        ).complete([], [], AbortSignal.timeout(5000))
      ).content,
    ).toBe("ok");
    expect(connects).toBe(3);
    expect(
      (
        await new ChatCompletionsTransport(
          { ...apiProfile, baseUrl: endpoint.url },
          async () => null,
        ).complete([], [], AbortSignal.timeout(5000))
      ).content,
    ).toBe("ok");
    expect(requests).toBe(4);
    expect(connects).toBe(3);
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:1");
    expect(getGlobalDispatcher()).toBe(dispatcher);
  } finally {
    await proxy.close();
    await endpoint.close();
  }
});

it("a failed explicit AI proxy never falls back to a direct model request", async () => {
  let requests = 0;
  const endpoint = await listen(
    createServer((_req, res) => {
      requests++;
      res.end(
        JSON.stringify({ choices: [{ message: { content: "unexpected" } }] }),
      );
    }),
  );
  const proxyServer = createServer((_req,res)=>res.writeHead(400).end());
  proxyServer.on("connect", (_req, client) =>
    client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"),
  );
  const proxy = await listen(proxyServer);
  try {
    await expect(
      new ChatCompletionsTransport(
        { ...apiProfile, baseUrl: endpoint.url, proxyUrl: proxy.url },
        async () => null,
      ).complete([], [], AbortSignal.timeout(20000)),
    ).rejects.toMatchObject({ code: "AI_ENDPOINT_UNREACHABLE" });
    expect(requests).toBe(0);
  } finally {
    await proxy.close();
    await endpoint.close();
  }
});

it("subscription connection proxy is scoped to its own process environment", async () => {
  vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:1");
  const environments: NodeJS.ProcessEnv[] = [];
  const run: typeof runProcess = async (_exe, _args, options) => {
    environments.push(options.env!);
    return JSON.stringify({ result: '{"result":{}}' });
  };
  const profile = {
    kind: "claude" as const,
    id: "cli",
    name: "cli",
    model: "",
    outboundEnabled: true,
    credentialRef: null,
    executable: "D:/claude.exe",
  };
  await new SubscriptionTransport(
    { ...profile, proxyUrl: "http://127.0.0.1:4321" },
    process.cwd(),
    run,
    undefined,
    async address=>({url:`http://${address.replace(/^https?:\/\//, "")}`,scheme:"http"}),
  ).complete([], [], AbortSignal.timeout(5000));
  await new SubscriptionTransport(profile, process.cwd(), run).complete(
    [],
    [],
    AbortSignal.timeout(5000),
  );
  expect(environments[0].HTTPS_PROXY).toBe("http://127.0.0.1:4321");
  expect(environments[0].NO_PROXY).toBeUndefined();
  expect(environments[1].HTTPS_PROXY).toBeUndefined();
  expect(environments[1].NO_PROXY).toBe("*");
  expect(process.env.HTTPS_PROXY).toBe("http://127.0.0.1:1");
});

it("profile accepts optional HTTP proxies and rejects embedded credentials and unsupported protocols", () => {
  const profile = {
    kind: "api",
    name: "test",
    model: "test",
    baseUrl: "https://model.example/v1",
    outboundEnabled: true,
  };
  expect(AIProfileDraftSchema.safeParse(profile).success).toBe(true);
  expect(
    AIProfileDraftSchema.safeParse({
      ...profile,
      proxyUrl: "https://proxy.example:443",
    }).success,
  ).toBe(true);
  for (const proxyUrl of [
    "http://user:secret@proxy.example",
    "socks5://proxy.example",
    "https://proxy.example/?token=secret",
  ]) {
    expect(
      AIProfileDraftSchema.safeParse({ ...profile, proxyUrl }).success,
    ).toBe(false);
  }
});
