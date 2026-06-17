/**
 * connectionLogStore — a small ring buffer of what the client does while
 * connecting to the server, surfaced as a read-only console on the "connecting"
 * screen (for programmers). Decoupled so non-React modules (lib/websocket.ts)
 * can append via the `logConn` accessor without importing React.
 */
import { create } from 'zustand';

export type ConnLogStatus = 'pending' | 'ok' | 'error' | 'info';

export interface ConnLogEntry {
  id: number;
  ts: number;
  /** Human-readable step, e.g. "opening socket", "socket open", "subscribe ide". */
  step: string;
  status: ConnLogStatus;
  /** Optional extra context (url, attempt, error message). */
  detail?: string;
}

const CAP = 200;
let seq = 0;

interface ConnLogState {
  entries: ConnLogEntry[];
  log: (step: string, status?: ConnLogStatus, detail?: string) => void;
  clear: () => void;
}

export const useConnectionLogStore = create<ConnLogState>((set) => ({
  entries: [],
  log: (step, status = 'info', detail) =>
    set((s) => {
      const next = [...s.entries, { id: ++seq, ts: Date.now(), step, status, detail }];
      return { entries: next.length > CAP ? next.slice(next.length - CAP) : next };
    }),
  clear: () => set({ entries: [] }),
}));

/** Non-hook accessor for modules that aren't React components (lib/websocket.ts). */
export const logConn = (step: string, status?: ConnLogStatus, detail?: string) =>
  useConnectionLogStore.getState().log(step, status, detail);
