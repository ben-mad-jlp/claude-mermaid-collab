import { contextBridge } from 'electron';

// Phase 0.1 — minimal, tiny preload. The `mc` namespace is the single
// contextBridge surface; later phases add IPC methods (browser pane bounds,
// server switch, etc.). Keep this small per the design's security guidance.
contextBridge.exposeInMainWorld('mc', {});
