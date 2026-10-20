import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/contracts/src/models";
const invoke = (method: string, params: object = {}) =>
  ipcRenderer.invoke("platform:request", { method, params });
const api: DesktopAPI = {
  discoverJiraConnection:(draft,secret)=>invoke("discoverJiraConnection",{draft,secret}),
  getDocumentResources: () => invoke("getDocumentResources"),
  saveDocumentResource: (draft, expectedRevision) => invoke("saveDocumentResource", { draft, expectedRevision }),
  deleteDocumentResource: (id, expectedRevision) => invoke("deleteDocumentResource", { id, expectedRevision }),
  getDefaultAIProfile: () => invoke("getDefaultAIProfile"),
  setDefaultAIProfile: id => invoke("setDefaultAIProfile", { id }),
  saveProjectLinks: input => invoke("saveProjectLinks", input),
  updateCode: (projectId, mode = "update") => invoke("updateCode", { projectId, mode }),
  getJiraCatalogue: (connectionId) => invoke("getJiraCatalogue", { connectionId }),
  getIssueConnections: () => invoke("getIssueConnections"),
  inspectLocalJira: () => invoke("inspectLocalJira"),
  saveIssueConnection: (draft, secret, id) =>
    invoke("saveIssueConnection", { draft, secret, id }),
  deleteIssueConnection: (id) => invoke("deleteIssueConnection", { id }),
  probeIssueConnection: (projectId, bindingId) =>
    invoke("probeIssueConnection", { projectId, bindingId }),
  getBugWorkspace: (projectId) => invoke("getBugWorkspace", { projectId }),
  refreshBugWorkspace: (projectId) => invoke("refreshBugWorkspace", { projectId }),
  getIssueMonitor: () => invoke("getIssueMonitor"),
  saveIssueMonitor: (configuration) => invoke("saveIssueMonitor", { configuration }),
  checkIssueNotifications: () => invoke("checkIssueNotifications"),
  refreshIssues: (projectId, bindingId) =>
    invoke("refreshIssues", { projectId, bindingId }),
  readIssueByKey: (projectId, bindingId, key) =>
    invoke("readIssueByKey", { projectId, bindingId, key }),
  analyzeBug: (projectId, issueSnapshotId) =>
    invoke("analyzeBug", { projectId, issueSnapshotId }),
  getBugReport: (projectId, reportId) =>
    invoke("getBugReport", { projectId, reportId }),
  exportBugReport: (projectId, reportId) =>
    invoke("exportBugReport", { projectId, reportId }),
  getReport: (projectId, reportId) =>
    invoke("getReport", { projectId, reportId }),
  readDocumentBlock: (projectId, contextId, documentSnapshotId, blockId) =>
    invoke("readDocumentBlock", {
      projectId,
      contextId,
      documentSnapshotId,
      blockId,
    }),
  getWorkspace: (projectId) => invoke("getWorkspace", { projectId }),
  saveRequirementRevision: (projectId, contextId, items, expectedRevision) =>
    invoke("saveRequirementRevision", {
      projectId,
      contextId,
      items,
      expectedRevision,
    }),
  extractRequirements: (projectId) =>
    invoke("extractRequirements", { projectId }),
  checkRequirements: (projectId, requirementSetId) =>
    invoke("checkRequirements", { projectId, requirementSetId }),
  searchEvidence: (projectId, contextId, query) =>
    invoke("searchEvidence", { projectId, contextId, query }),
  readEvidence: (projectId, contextId, evidence) =>
    invoke("readEvidence", { projectId, contextId, evidence }),
  getAIProfiles: () => invoke("getAIProfiles"),
  saveAIProfile: (draft, secret, id) =>
    invoke("saveAIProfile", { draft, secret, id }),
  deleteAIProfile: (id) => invoke("deleteAIProfile", { id }),
  getCliConfiguration: () => invoke("getCliConfiguration"),
  saveCliConfiguration: (configuration) =>
    invoke("saveCliConfiguration", { configuration }),
  probeExecutor: (id) => invoke("probeExecutor", { id }),
  probeFeishu: () => invoke("probeFeishu"),
  chooseDocumentFiles: () => invoke("chooseDocumentFiles"),
  exportReport: (projectId, reportId) =>
    invoke("exportReport", { projectId, reportId }),
  listProjects: () => invoke("listProjects"),
  saveProjectDocuments: (projectId, documents, expectedRevision) => invoke("saveProjectDocuments", { projectId, documents, expectedRevision }),
  deleteProject: (projectId, expectedRevision) =>
    invoke("deleteProject", { projectId, expectedRevision }),
  openIssue: (projectId, issueSnapshotId) =>
    invoke("openIssue", { projectId, issueSnapshotId }),
  saveProject: (draft, expectedRevision) =>
    invoke("saveProject", { draft, expectedRevision }),
  inspectRepository: (binding) => invoke("inspectRepository", { binding }),
  readCurrentBranch: (path) => invoke("readCurrentBranch", { path }),
  prepareContext: (projectId) => invoke("prepareContext", { projectId }),
  listTasks: (projectId) => invoke("listTasks", { projectId }),
  getTaskEvents: (taskId) => invoke("getTaskEvents", { taskId }),
  getContext: (snapshotId) => invoke("getContext", { snapshotId }),
  cancelTask: (taskId) => invoke("cancelTask", { taskId }),
  retryTask: (taskId) => invoke("retryTask", { taskId }),
  chooseRepositoryDirectory: () => invoke("chooseRepositoryDirectory"),
  getAppInfo: () => invoke("getAppInfo"),
  backupDatabase: () => invoke("backupDatabase"),
};
contextBridge.exposeInMainWorld("platform", Object.freeze(api));
