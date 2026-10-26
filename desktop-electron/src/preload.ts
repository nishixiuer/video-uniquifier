import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  publishing: (method: string, params: object = {}) =>
    ipcRenderer.invoke("publishing:call", method, params),
  openPost: (taskId: string) => ipcRenderer.invoke("publishing:open", taskId),
  call: (method: string, params: object = {}) =>
    ipcRenderer.invoke("engine:call", method, params),
  pick: (
    kind: string = "video",
    multiple: boolean = false,
  ): Promise<string[]> => ipcRenderer.invoke("dialog:pick", kind, multiple),
  list: (path: string, recursive: boolean = false): Promise<string[]> =>
    ipcRenderer.invoke("files:list", path, recursive),
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke("files:read-text", path),
  reveal: (path: string) => ipcRenderer.invoke("files:reveal", path),
  mediaUrl: (path: string): Promise<string> =>
    ipcRenderer.invoke("files:media-url", path),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  saveSettings: (settings: object) =>
    ipcRenderer.invoke("settings:save", settings),
  onJob: (callback: (job: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, job: unknown) =>
      callback(job);
    ipcRenderer.on("engine:job", handler);
    return () => ipcRenderer.removeListener("engine:job", handler);
  },
  onError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) =>
      callback(error);
    ipcRenderer.on("engine:error", handler);
    return () => ipcRenderer.removeListener("engine:error", handler);
  },
});
