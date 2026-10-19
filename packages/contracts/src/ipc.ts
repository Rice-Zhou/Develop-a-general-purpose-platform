import { z } from 'zod';
import { AppError } from './error';
import { ProjectDraftSchema } from './models';
const empty = z.object({}).strict();
const id = z.uuid();
const binding = z.object({ id: z.string().min(1), canonicalPath: z.string().min(1), remoteName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), branch: z.string().min(1), role: z.string(), remoteUrlFingerprint: z.string().nullable() }).strict();
const request = z.discriminatedUnion('method', [
  z.object({ method: z.literal('listProjects'), params: empty }).strict(),
  z.object({ method: z.literal('saveProject'), params: z.object({ draft: ProjectDraftSchema, expectedRevision: z.number().int().positive().optional() }).strict() }).strict(),
  z.object({ method: z.literal('inspectRepository'), params: z.object({ binding }).strict() }).strict(),
  z.object({ method: z.literal('prepareContext'), params: z.object({ projectId: id }).strict() }).strict(),
  z.object({ method: z.literal('listTasks'), params: z.object({ projectId: id.optional() }).strict() }).strict(),
  ...(['getTaskEvents', 'cancelTask', 'retryTask'] as const).map(method => z.object({ method: z.literal(method), params: z.object({ taskId: id }).strict() }).strict()),
  z.object({ method: z.literal('getContext'), params: z.object({ snapshotId: id }).strict() }).strict(),
  ...(['chooseRepositoryDirectory', 'getAppInfo', 'backupDatabase'] as const).map(method => z.object({ method: z.literal(method), params: empty }).strict()),
]);
export type Request = z.infer<typeof request>;
export function parseRequest(input: unknown): Request {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(';'), 'ipc');
  return parsed.data;
}
export function assertTrustedSender(senderId: number, windowId: number, mainFrame: boolean): void {
  if (senderId !== windowId || !mainFrame) throw new AppError('UNTRUSTED_SENDER', '拒绝来自非应用主窗口的请求', 'ipc');
}
