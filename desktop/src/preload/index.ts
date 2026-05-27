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
  setZoomFactor: (factor: number) => ipcRenderer.invoke('mc:setZoomFactor', factor),
  probeServer: (host: string, port: number) => ipcRenderer.invoke('mc:probeServer', { host, port }),
  setWatchedServers: (ids: string[]) => ipcRenderer.invoke('mc:setWatchedServers', ids),
  onWatchEvent: (cb: (e: any) => void) => {
    const h = (_e: any, evt: any) => cb(evt);
    ipcRenderer.on('mc:watch-event', h);
    return () => ipcRenderer.removeListener('mc:watch-event', h);
  },
  browser: {
    listTabs: () => ipcRenderer.invoke('mc:browser:listTabs'),
    openTab: (opts: { url?: string }) => ipcRenderer.invoke('mc:browser:openTab', opts),
    closeTab: (id: string) => ipcRenderer.invoke('mc:browser:closeTab', id),
    activateTab: (id: string) => ipcRenderer.invoke('mc:browser:activateTab', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('mc:browser:navigate', id, url),
    goBack: (id: string) => ipcRenderer.invoke('mc:browser:goBack', id),
    goForward: (id: string) => ipcRenderer.invoke('mc:browser:goForward', id),
    reload: (id: string) => ipcRenderer.invoke('mc:browser:reload', id),
    setBounds: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('mc:browser:setBounds', rect),
  },
});
