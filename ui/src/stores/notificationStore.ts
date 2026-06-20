/**
 * Notification + triage-action store.
 *
 * HTTP+WS only, mobile-portable: all server I/O routes through apiFetch (no
 * direct window.mc calls, no Electron-only APIs, no absolute desktop URLs).
 * Summary state is consumed from supervisorStore via the existing WS-ingested
 * sessionSummaries — this store never holds or polls summary data.
 * Phase-2 thin-client port can reuse this file verbatim.
 */
import { create } from 'zustand';
import { apiFetch } from '@/lib/api';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration: number;
  timestamp: number;
}

/** A client-only snooze record. Keyed by the triage item id (escalation id or a
 *  synthetic notification id). expiresAt is wall-clock ms; the live timer clears
 *  the flag on expiry so the item re-surfaces. Never sent to the server. */
export interface SnoozeEntry { id: string; expiresAt: number; }

/** A pending optimistic clear awaiting its 5s undo window before it commits to the
 *  server. `commit` is the deferred server mutation (returns the InvokeResult-ish
 *  ok). `toastId` ties it to the "sent → X" undo toast so Undo can both cancel the
 *  timer and dismiss the toast. */
export interface PendingClear {
  id: string;
  label: string;
  toastId: string;
  timer: ReturnType<typeof setTimeout>;
  commit: () => Promise<boolean>;
}

interface NotificationState {
  toasts: Toast[];
  snoozed: Record<string, SnoozeEntry>;
  snoozeTimers: Record<string, ReturnType<typeof setTimeout>>;
  operatorOnly: Record<string, true>;
  pendingClears: Record<string, PendingClear>;
}

interface NotificationActions {
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
  refreshSummaryNow: (serverId: string, project: string, session: string) => Promise<boolean>;
  snoozeItem: (id: string, ms: number) => void;
  unsnoozeItem: (id: string) => void;
  isSnoozed: (id: string) => boolean;
  markOperatorOnly: (id: string, on?: boolean) => void;
  isOperatorOnly: (id: string) => boolean;
  clearItemOptimistic: (id: string, label: string, commit: () => Promise<boolean>) => void;
  undoClear: (id: string) => void;
  commitClear: (id: string) => Promise<void>;
  setWatchdogThreshold: (serverId: string, project: string, percent: number) => Promise<boolean>;
}

// Helper function to generate a random hex string
const randomHex = (length: number): string => {
  return Math.floor(Math.random() * Math.pow(16, length))
    .toString(16)
    .padStart(length, '0');
};

/** Deterministic triage ordering. Higher rank = more urgent / sorts first.
 *  operator floor (server operatorGated OR local only-you) outranks everything;
 *  ties broken by a stable key (createdAt then id) so order never jitters. */
export function triageRank(
  item: { id: string; operatorGated?: boolean | number; createdAt?: number },
  operatorOnly: Record<string, true>,
): number {
  const operatorFloor = !!item.operatorGated || !!operatorOnly[item.id];
  return operatorFloor ? 1 : 0;
}

export function compareTriage(
  a: { id: string; operatorGated?: boolean | number; createdAt?: number },
  b: { id: string; operatorGated?: boolean | number; createdAt?: number },
  operatorOnly: Record<string, true>,
): number {
  const r = triageRank(b, operatorOnly) - triageRank(a, operatorOnly);
  if (r !== 0) return r;
  const t = (b.createdAt ?? 0) - (a.createdAt ?? 0);
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const useNotificationStore = create<NotificationState & NotificationActions>((set, get) => ({
  toasts: [],
  snoozed: {} as Record<string, SnoozeEntry>,
  snoozeTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
  operatorOnly: {} as Record<string, true>,
  pendingClears: {} as Record<string, PendingClear>,

  addToast: (toast) => {
    const id = `toast_${Date.now()}_${randomHex(4)}`;
    const fullToast: Toast = {
      id,
      timestamp: Date.now(),
      ...toast,
    };
    set((state) => ({
      toasts: [...state.toasts, fullToast],
    }));
    if (toast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, toast.duration);
    }
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },

  refreshSummaryNow: async (serverId, project, session) => {
    const res = await apiFetch(serverId, '/api/supervisor/refresh-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session }),
    }).catch(() => null);
    return !!res?.ok;
  },

  snoozeItem: (id, ms) => {
    const prev = get().snoozeTimers[id];
    if (prev) clearTimeout(prev);
    const expiresAt = Date.now() + ms;
    const timer = setTimeout(() => get().unsnoozeItem(id), ms);
    set((s) => ({
      snoozed: { ...s.snoozed, [id]: { id, expiresAt } },
      snoozeTimers: { ...s.snoozeTimers, [id]: timer },
    }));
  },

  unsnoozeItem: (id) => {
    const t = get().snoozeTimers[id];
    if (t) clearTimeout(t);
    set((s) => {
      const snoozed = { ...s.snoozed }; delete snoozed[id];
      const snoozeTimers = { ...s.snoozeTimers }; delete snoozeTimers[id];
      return { snoozed, snoozeTimers };
    });
  },

  isSnoozed: (id) => {
    const e = get().snoozed[id];
    return !!e && e.expiresAt > Date.now();
  },

  markOperatorOnly: (id, on = true) =>
    set((s) => {
      const operatorOnly = { ...s.operatorOnly };
      if (on) operatorOnly[id] = true; else delete operatorOnly[id];
      return { operatorOnly };
    }),

  isOperatorOnly: (id) => !!get().operatorOnly[id],

  clearItemOptimistic: (id, label, commit) => {
    if (get().pendingClears[id]) return;
    const toastId = get().addToast({ type: 'info', title: `sent → ${label}`, duration: 0 });
    const timer = setTimeout(() => { get().commitClear(id); }, 5000);
    set((s) => ({ pendingClears: { ...s.pendingClears, [id]: { id, label, toastId, timer, commit } } }));
  },

  undoClear: (id) => {
    const p = get().pendingClears[id];
    if (!p) return;
    clearTimeout(p.timer);
    get().removeToast(p.toastId);
    set((s) => { const pc = { ...s.pendingClears }; delete pc[id]; return { pendingClears: pc }; });
  },

  commitClear: async (id) => {
    const p = get().pendingClears[id];
    if (!p) return;
    get().removeToast(p.toastId);
    const ok = await p.commit().catch(() => false);
    set((s) => { const pc = { ...s.pendingClears }; delete pc[id]; return { pendingClears: pc }; });
    if (!ok) get().addToast({ type: 'error', title: 'Clear failed — item restored', duration: 4000 });
  },

  setWatchdogThreshold: async (serverId, project, percent) => {
    const res = await apiFetch(serverId, '/api/supervisor/watchdog-threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, thresholdPercent: percent }),
    }).catch(() => null);
    return !!res?.ok;
  },
}));
