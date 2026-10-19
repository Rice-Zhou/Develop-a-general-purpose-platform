import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFixture } from '../../packages/testkit/src/git-fixture';

test('real desktop persists projects and prepares a pinned context without exposing Node', async () => {
  const data = await mkdtemp(join(tmpdir(), 'local-platform-e2e-'));
  const fixture = await gitFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env: { ...process.env, PLATFORM_DATA_DIR: data, PLATFORM_E2E: '1', ELECTRON_ENABLE_LOGGING: '1' } });
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '研发工作台' })).toBeVisible();
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    await page.getByRole('button', { name: '项目管理', exact: true }).click();
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('A 项目');
    await page.getByLabel('分析目录', { exact: true }).fill(fixture.analysis);
    await page.getByLabel('分析分支').fill('main');
    await page.getByRole('button', { name: '保存项目', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A 项目', exact: true })).toBeVisible();
    await fixture.publish('updated for desktop test\n');
    await page.getByRole('button', { name: '更新并准备上下文' }).click();
    await expect(page.getByText('准备成功', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '查看详情' }).first().click();
    await expect(page.getByText('代码快照', { exact: true })).toBeVisible();
    await app.close(); app = undefined;
    app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env: { ...process.env, PLATFORM_DATA_DIR: data, PLATFORM_E2E: '1' } });
    page = await app.firstWindow();
    await page.getByRole('button', { name: '项目管理', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A 项目', exact: true })).toBeVisible();
  } finally {
    if (app) await app.close();
    await fixture.dispose(); await rm(data, { recursive: true, force: true });
  }
});
