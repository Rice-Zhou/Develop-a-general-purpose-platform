import { z } from "zod";
import type { ErrorData } from "./models";
import type { IssueSnapshot } from "./issues";

export const IssueMonitorConfigurationSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440),
  notificationsEnabled: z.boolean(),
}).strict();
export type IssueMonitorConfiguration = z.infer<typeof IssueMonitorConfigurationSchema>;
export const DEFAULT_ISSUE_MONITOR_CONFIGURATION: IssueMonitorConfiguration = {
  enabled: true, intervalMinutes: 5, notificationsEnabled: true,
};
export interface IssueListItem extends IssueSnapshot { webUrl: string; analysisProjectId?: string; analysisProjectName?: string; analysisUnavailable?: string }
export interface IssueSourceState {
  bindingId: string;
  label: string;
  status: "idle" | "success" | "failed";
  count: number;
  lastSuccessAt: string | null;
  error: ErrorData | null;
}
export interface IssueWorkspace {
  issues: IssueListItem[];
  sources: IssueSourceState[];
}
export const NotificationOpenIdSchema = z.string().regex(/^ou_[A-Za-z0-9_-]+$/).max(200);
export const NotificationRecipientSchema = z.object({ openId: NotificationOpenIdSchema, name: z.string().min(1).max(200), department: z.string().max(500).optional() }).strict();
export const RecipientQuerySchema = z.string().trim().min(1).max(50);
export type NotificationRecipient = z.infer<typeof NotificationRecipientSchema>;
export interface NotificationRecipientSearch { users: NotificationRecipient[]; hasMore: boolean }
export interface IssueNotification {
  id: string;
  projectId: string;
  bindingId: string;
  scopeHash: string;
  remoteId: string;
  key: string;
  text: string;
}
export interface IssueNotifier {
  search(query: string, signal: AbortSignal): Promise<NotificationRecipientSearch>;
  self(signal: AbortSignal): Promise<NotificationRecipient>;
  send(event: IssueNotification, recipient: NotificationRecipient, signal: AbortSignal, authorize: () => void): Promise<void>;
}
export interface IssueMonitorStatus {
  configuration: IssueMonitorConfiguration;
  recipient: NotificationRecipient | null;
  pendingCount: number;
  notificationError: ErrorData | null;
  lastNotificationAt: string | null;
  runtimeError: ErrorData | null;
  running: boolean;
}
