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
