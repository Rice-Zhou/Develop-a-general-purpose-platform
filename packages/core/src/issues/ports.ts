import type { IssueScope, RemoteIssue, IssueConnection, JiraCatalogue } from "../../../contracts/src/issues";
import type { AttachmentDescriptor } from "../../../contracts/src/issue-materials";
export interface IssueAdapter {
  listAttachments?(scope:IssueScope,issue:RemoteIssue,signal:AbortSignal):Promise<AttachmentDescriptor[]>;
  downloadAttachment?(scope:IssueScope,issue:RemoteIssue,attachmentId:string,destination:string,signal:AbortSignal,maxBytes?:number):Promise<{size:number;sha256:string}>;
  discover?(connection: IssueConnection, signal: AbortSignal): Promise<JiraCatalogue>;
  list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]>;
  get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue>;
}
