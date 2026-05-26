import { contextBridge, ipcRenderer } from 'electron';

// The `mc` bridge — the single contextBridge surface to the main process.
// Server-switcher methods are thin IPC wrappers; tokens never cross this
// boundary (the store omits them; the proxy injects them in main).
contextBridge.exposeInMainWorld('mc', {
  listServers: () => ipcRenderer.invoke('mc:listServers'),
  getActiveServer: () => ipcRenderer.invoke('mc:getActiveServer'),
  switchServer: (id: string) => ipcRenderer.invoke('mc:switchServer', id),
  addServer: (opts: { label: string; host: string; port: number; token?: string }) =>
    ipcRenderer.invoke('mc:addServer', opts),
  removeServer: (id: string) => ipcRenderer.invoke('mc:removeServer', id),
});
