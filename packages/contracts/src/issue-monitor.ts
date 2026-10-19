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
export interface IssueListItem extends IssueSnapshot { webUrl: string }
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
export interface NotificationRecipient { openId: string; name: string }
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
