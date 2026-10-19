import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
const config: ForgeConfig = {
  packagerConfig: { asar: true, executableName: 'LocalDevPlatform', appBundleId: 'local.dev.platform' },
  rebuildConfig: {},
  makers: [new MakerSquirrel({ name: 'LocalDevPlatform', setupExe: 'LocalDevPlatformSetup.exe' }), new MakerZIP({}, ['win32'])],
  plugins: [new AutoUnpackNativesPlugin({}), new VitePlugin({ build: [
    { entry: 'apps/desktop/src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
    { entry: 'apps/desktop/src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
    { entry: 'apps/desktop/src/service/service.ts', config: 'vite.service.config.ts', target: 'main' },
  ], renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }] })],
};
export default config;
