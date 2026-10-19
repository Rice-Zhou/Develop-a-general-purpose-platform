import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../../../contracts/src/error';
const exec = promisify(execFile);
export async function terminateProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new AppError('INVALID_PROCESS', '拒绝终止无效进程', 'git');
  try {
    if (process.platform === 'win32') await exec('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    else process.kill(-pid, 'SIGKILL');
  } catch (error) {
    throw new AppError('PROCESS_STOP_UNCONFIRMED', `无法确认任务进程树已停止：${error instanceof Error ? error.message : String(error)}`, 'git', false, '确认相关进程结束后重新启动应用');
  }
}
