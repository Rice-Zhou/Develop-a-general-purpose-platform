import type { IssueScope, RemoteIssue, IssueConnection, JiraCatalogue } from "../../../contracts/src/issues";
export interface IssueAdapter {
  discover?(connection: IssueConnection, signal: AbortSignal): Promise<JiraCatalogue>;
  list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]>;
  get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue>;
}
