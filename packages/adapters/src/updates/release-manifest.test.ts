import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateUpdateManifest } from "../../../../scripts/generate-update-manifest";
it("generates size and SHA from this version's final installer and rejects stale or empty output", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-manifest-"));
  try {
    const dir = join(root, "1.0.1", "make", "squirrel.windows", "x64");
    await mkdir(dir, { recursive: true });
    const installerPath = join(dir, "LocalDevPlatformSetup.exe"),
      outputPath = join(dir, "platform-update.json");
    await expect(
      generateUpdateManifest({ version: "1.0.1", installerPath, outputPath }),
    ).rejects.toThrow();
    await writeFile(installerPath, "first");
    const first = await generateUpdateManifest({
      version: "1.0.1",
      installerPath,
      outputPath,
    });
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(first);
    await writeFile(installerPath, "different bytes");
    const second = await generateUpdateManifest({
      version: "1.0.1",
      installerPath,
      outputPath,
    });
    expect(first.sha256).not.toBe(second.sha256);
    expect(first.size).not.toBe(second.size);
    await expect(
      generateUpdateManifest({ version: "1.0.2", installerPath, outputPath }),
    ).rejects.toThrow();
    await writeFile(installerPath, "");
    await expect(
      generateUpdateManifest({ version: "1.0.1", installerPath, outputPath }),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
