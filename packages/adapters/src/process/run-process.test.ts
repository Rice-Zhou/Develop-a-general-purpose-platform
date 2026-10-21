import { expect, it } from "vitest";
import { runProcess } from "./run-process";
it("runs a fixed executable without a shell and bounds its output", async () => {
  expect(
    await runProcess(
      process.execPath,
      ["-e", "process.stdin.on('data',d=>process.stdout.write(d))"],
      { input: "data", cwd: process.cwd() },
    ),
  ).toBe("data");
  await expect(
    runProcess(
      process.execPath,
      ["-e", "console.log('x'.repeat(1000));setInterval(()=>{},1000)"],
      { cwd: process.cwd(), maxOutput: 20 },
    ),
  ).rejects.toMatchObject({ code: "PROCESS_OUTPUT_LIMIT" });
});
it("terminates a timed-out process before returning", async () => {
  await expect(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: process.cwd(),
      timeoutMs: 150,
    }),
  ).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
});
it("reports sanitized tool diagnostics and rejects command templates", async () => {
  await expect(
    runProcess("cmd /c whoami", [], { cwd: process.cwd() }),
  ).rejects.toMatchObject({ code: "CLI_PATH_INVALID" });
  const error = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stderr.write('backend-unavailable token=private-value');process.exit(3)",
    ],
    { cwd: process.cwd() },
  ).then(
    () => null,
    (error) => error as Error,
  );
  expect(error?.message).toContain("backend-unavailable");
  expect(error?.message).not.toContain("private-value");
});
it("retains substantive JSON failure messages ahead of stderr noise without exposing model content or credentials", async () => {
  const events = [
    { type: "item.completed", item: { type: "agent_message", text: "private project material" } },
    { type: "error", message: "Selected model is not supported token=secret-token https://example.test/?key=secret-url sk-1234567890abcdef" },
    { type: "turn.failed", error: { message: "Selected model is not supported" } },
  ];
  const error = await runProcess(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(events.map(event => JSON.stringify(event)).join("\n"))});process.stderr.write('failed to load skill: missing YAML frontmatter\\n'+'noise '.repeat(1000));process.exitCode=1`], { cwd: process.cwd() }).catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("Selected model is not supported");
  for (const secret of ["private project material", "secret-token", "secret-url", "sk-1234567890abcdef"])
    expect(message).not.toContain(secret);
});
