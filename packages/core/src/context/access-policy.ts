import { posix } from 'node:path';
import { AppError } from '../../../contracts/src/error';
const sensitive = /(^|\/)(\.env(?:\..*)?|\.git|\.ssh|\.aws|credentials(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|p12|pfx|key))($|\/)/i;
export function readablePath(path: string): boolean {
  return path.length > 0 && !path.includes('\\') && !path.includes(':') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').includes('..') && posix.normalize(path) === path && !sensitive.test(path);
}
export function assertReadablePath(path: string): void { if (!readablePath(path)) throw new AppError('PATH_DENIED', '路径越界或属于默认排除的敏感文件', 'context'); }
