import type { ErrorData } from './models';
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly stage = 'application', public readonly retryable = false, public readonly requiredAction: string | null = null) { super(message); this.name = 'AppError'; }
}
export function errorData(error: unknown): ErrorData {
  if (error instanceof AppError) return { code: error.code, stage: error.stage, message: error.message, retryable: error.retryable, requiredAction: error.requiredAction, diagnosticRef: null };
  return { code: 'UNEXPECTED', stage: 'application', message: (error instanceof Error ? error.message : String(error)).slice(0, 2000), retryable: false, requiredAction: '查看任务详情并处理错误后重试', diagnosticRef: null };
}
