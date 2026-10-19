import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../../../../packages/contracts/src/models";
const invoke = (method: string, params: object = {}) =>
  ipcRenderer.invoke("platform:request", { method, params });
const api: DesktopAPI = {
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
