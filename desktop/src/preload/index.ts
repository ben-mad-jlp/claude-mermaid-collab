import { contextBridge, ipcRenderer, webUtils } from 'electron';

// The `mc` bridge — the single contextBridge surface to the main process.
// Server-switcher methods are thin IPC wrappers; tokens never cross this
// boundary (the store omits them; the proxy injects them in main).
contextBridge.exposeInMainWorld('mc', {
  listServers: () => ipcRenderer.invoke('mc:listServers'),
  addServer: (opts: { label: string; host: string; port: number; token?: string }) =>
    ipcRenderer.invoke('mc:addServer', opts),
  removeServer: (id: string) => ipcRenderer.invoke('mc:removeServer', id),
  // P4a pairing: pair a pending discovered server / unpair (DELETE) a paired one.
  // Each returns the updated server list (tokens omitted) for an immediate refresh.
  pairServer: (id: string) => ipcRenderer.invoke('mc:pairServer', id),
  unpairServer: (id: string) => ipcRenderer.invoke('mc:unpairServer', id),
  setServerToken: (id: string, token: string | undefined) =>
    ipcRenderer.invoke('mc:setServerToken', id, token),
  // Resolve a dropped File's absolute filesystem path. Electron 32+ removed
  // File.path; webUtils.getPathForFile is the supported renderer-side replacement
  // (synchronous, no IPC). Used by the terminal composer's drag-to-insert-path.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  setZoomFactor: (factor: number) => ipcRenderer.invoke('mc:setZoomFactor', factor),
  probeServer: (host: string, port: number) => ipcRenderer.invoke('mc:probeServer', { host, port }),
  // Native OS folder picker (Add Project / Add Watching). Resolves to the chosen
  // absolute path, or null when cancelled. Absent in a plain browser → UI falls back
  // to the in-app folder browser.
  pickFolder: (opts?: { defaultPath?: string; title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('mc:pickFolder', opts),
  setWatchedServers: (ids: string[]) => ipcRenderer.invoke('mc:setWatchedServers', ids),
  listSessionsForServer: (serverId: string) => ipcRenderer.invoke('mc:listSessionsForServer', serverId),
  getServerCapabilities: (serverId: string) => ipcRenderer.invoke('mc:getServerCapabilities', serverId),
  invokeOnServer: (serverId: string, opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }) =>
    ipcRenderer.invoke('mc:invokeOnServer', serverId, opts),
  openExternalTerminal: (tmuxName: string) => ipcRenderer.invoke('mc:openExternalTerminal', tmuxName),
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
  // Live startup progress for the loading screen (phase + a human message with the
  // sidecar's latest log line + elapsed). Lets it show real info, not a bare spinner.
  onBootstrapProgress: (cb: (info: { phase: string; message: string; elapsedMs: number }) => void) => {
    const h = (_e: any, info: any) => cb(info);
    ipcRenderer.on('mc:bootstrap-progress', h);
    return () => ipcRenderer.removeListener('mc:bootstrap-progress', h);
  },
  retryBootstrap: () => ipcRenderer.invoke('mc:retry-bootstrap'),
  // Phase-1 dictionary injection: push words into the OS/Electron spellchecker's
  // session dictionary so custom vocabulary stops squiggling. No return value needed.
  addSpellCheckWords: (words: string[]) => ipcRenderer.invoke('mc:spellcheck-add-words', words),
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
    setZoom: (id: string, factor: number): Promise<number> => ipcRenderer.invoke('mc:browser:setZoom', id, factor),
    getZoom: (id: string): Promise<number> => ipcRenderer.invoke('mc:browser:getZoom', id),
    setBounds: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('mc:browser:setBounds', rect),
    // Main fires this when the browser_* tools ensure a session pane — the
    // renderer uses it to open + focus the built-in browser panel on that session.
    onSessionEnsured: (cb: (session: string) => void) => {
      const h = (_e: any, session: string) => cb(session);
      ipcRenderer.on('mc:browser:session-ensured', h);
      return () => ipcRenderer.removeListener('mc:browser:session-ensured', h);
    },
  },
});
