import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
export interface IssueAdapter {
  list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]>;
  get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue>;
}
