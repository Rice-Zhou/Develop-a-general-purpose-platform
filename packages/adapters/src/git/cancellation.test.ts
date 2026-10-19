import { expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitFixture } from "../../../testkit/src/git-fixture";
import { AppError } from "../../../contracts/src/error";
import { runGit } from "./git-process";
import { terminateProcessTree } from "./process-tree";
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};
it("reports a failed process stop promptly without claiming the still-running task was cancelled", async () => {
  const f = await gitFixture();
  const helper = join(f.root, "wait.cjs");
  const marker = join(f.root, "pid");
  const controller = new AbortController();
  let rootPid = 0;
  let helperPid = 0;
  await writeFile(
    helper,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`,
  );
  const command = `!"${process.execPath.replace(/\\/g, "/")}" "${helper.replace(/\\/g, "/")}"`;
  const result = runGit(
    f.analysis,
    ["-c", `alias.wait=${command}`, "wait"],
    controller.signal,
    [0],
    {
      terminate: async (pid: number) => {
        rootPid = pid;
        throw new AppError("PROCESS_STOP_UNCONFIRMED", "Cannot verify stop");
      },
    },
  ).then(
    () => "unexpected success",
    (error) => error,
  );
  try {
    for (let i = 0; i < 150; i++) {
      try {
        helperPid = Number(await readFile(marker, "utf8"));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    expect(helperPid).toBeGreaterThan(0);
    controller.abort();
    const outcome = await Promise.race([
      result,
      new Promise((resolve) =>
        setTimeout(() => resolve("stop failure was hidden"), 2000),
      ),
    ]);
    expect(outcome).toMatchObject({ code: "PROCESS_STOP_UNCONFIRMED" });
    expect(alive(helperPid)).toBe(true);
  } finally {
    if (rootPid && alive(rootPid)) await terminateProcessTree(rootPid);
    else if (helperPid && alive(helperPid))
      await terminateProcessTree(helperPid);
    controller.abort();
    await result;
    await f.dispose();
  }
});
