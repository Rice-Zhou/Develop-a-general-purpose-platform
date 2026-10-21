import {dirname,join} from "node:path";
import {generateUpdateManifest} from "./scripts/generate-update-manifest";
import appPackage from "./package.json";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
const config: ForgeConfig = {
  outDir: process.env.PLATFORM_BUILD_DIR || `out/releases/${appPackage.version}`,
  hooks:{postMake:async(_config,results)=>{
    const installers=results.filter(r=>r.platform==="win32"&&r.arch==="x64").flatMap(r=>r.artifacts).filter(path=>path.endsWith("LocalDevPlatformSetup.exe"));
    if(installers.length!==1)throw new Error("本次构建必须且只能生成一个 Windows x64 Setup.exe");
    const installerPath=installers[0];await generateUpdateManifest({version:appPackage.version,installerPath,outputPath:join(dirname(installerPath),"platform-update.json")});
    return results;
  }},
  packagerConfig: {
    electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined,
    asar: true,
    extraResource:[".vite/build/update-helper.cjs"],
    executableName: "LocalDevPlatform",
    appBundleId: "local.dev.platform",
    // Vite leaves native modules external; keep their production dependency tree.
    ignore: (path: string) =>
      Boolean(path) &&
      path !== "/package.json" &&
      !path.startsWith("/.vite") &&
      !path.startsWith("/node_modules"),
  },
  // These pinned releases ship Node-API binaries; rebuilding would discard them.
  rebuildConfig: { ignoreModules: ["better-sqlite3", "koffi"] },
  makers: [
    new MakerSquirrel({
      name: "LocalDevPlatform",
      setupExe: "LocalDevPlatformSetup.exe",
    }),
    new MakerZIP({}, ["win32"]),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {entry:"apps/desktop/src/main/update-helper.ts",config:"vite.update-helper.config.ts",target:"main"},
        {
          entry: "packages/adapters/src/documents/parser-worker.ts",
          config: "vite.parser.config.ts",
          target: "main",
        },
        {
          entry: "apps/desktop/src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "apps/desktop/src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "apps/desktop/src/service/service.ts",
          config: "vite.service.config.ts",
          target: "main",
        },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};
export default config;
