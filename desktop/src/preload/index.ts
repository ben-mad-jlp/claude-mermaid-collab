import { contextBridge, ipcRenderer } from 'electron';

// The `mc` bridge — the single contextBridge surface to the main process.
// Server-switcher methods are thin IPC wrappers; tokens never cross this
// boundary (the store omits them; the proxy injects them in main).
contextBridge.exposeInMainWorld('mc', {
  listServers: () => ipcRenderer.invoke('mc:listServers'),
  addServer: (opts: { label: string; host: string; port: number; token?: string }) =>
    ipcRenderer.invoke('mc:addServer', opts),
  removeServer: (id: string) => ipcRenderer.invoke('mc:removeServer', id),
  setZoomFactor: (factor: number) => ipcRenderer.invoke('mc:setZoomFactor', factor),
  probeServer: (host: string, port: number) => ipcRenderer.invoke('mc:probeServer', { host, port }),
  setWatchedServers: (ids: string[]) => ipcRenderer.invoke('mc:setWatchedServers', ids),
  listSessionsForServer: (serverId: string) => ipcRenderer.invoke('mc:listSessionsForServer', serverId),
  getServerCapabilities: (serverId: string) => ipcRenderer.invoke('mc:getServerCapabilities', serverId),
  invokeOnServer: (serverId: string, opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }) =>
    ipcRenderer.invoke('mc:invokeOnServer', serverId, opts),
  onWatchEvent: (cb: (e: any) => void) => {
    const h = (_e: any, evt: any) => cb(evt);
    ipcRenderer.on('mc:watch-event', h);
    return () => ipcRenderer.removeListener('mc:watch-event', h);
  },
  onZoom: (cb: (dir: 'in' | 'out' | 'reset') => void) => {
    const h = (_e: any, dir: 'in' | 'out' | 'reset') => cb(dir);
    ipcRenderer.on('mc:zoom', h);
    return () => ipcRenderer.removeListener('mc:zoom', h);
  },
  // Startup failure surface for the loading screen: main sends mc:bootstrap-error
  // when the sidecar never becomes healthy; retryBootstrap re-runs the spawn.
  onBootstrapError: (cb: (info: { message: string; detail?: string; logPath?: string }) => void) => {
    const h = (_e: any, info: any) => cb(info);
    ipcRenderer.on('mc:bootstrap-error', h);
    return () => ipcRenderer.removeListener('mc:bootstrap-error', h);
  },
  retryBootstrap: () => ipcRenderer.invoke('mc:retry-bootstrap'),
  browser: {
    listTabs: () => ipcRenderer.invoke('mc:browser:listTabs'),
    openTab: (opts: { url?: string }) => ipcRenderer.invoke('mc:browser:openTab', opts),
    closeTab: (id: string) => ipcRenderer.invoke('mc:browser:closeTab', id),
    activateTab: (id: string) => ipcRenderer.invoke('mc:browser:activateTab', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('mc:browser:navigate', id, url),
    goBack: (id: string) => ipcRenderer.invoke('mc:browser:goBack', id),
    goForward: (id: string) => ipcRenderer.invoke('mc:browser:goForward', id),
    reload: (id: string) => ipcRenderer.invoke('mc:browser:reload', id),
    devtools: (id: string) => ipcRenderer.invoke('mc:browser:devtools', id),
    setBounds: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('mc:browser:setBounds', rect),
  },
});
