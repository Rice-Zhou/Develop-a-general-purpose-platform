import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/contracts/src/models";
const invoke = (method: string, params: object = {}) =>
  ipcRenderer.invoke("platform:request", { method, params });
const api: DesktopAPI = {
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
  saveProject: (draft, expectedRevision) =>
    invoke("saveProject", { draft, expectedRevision }),
  inspectRepository: (binding) => invoke("inspectRepository", { binding }),
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
