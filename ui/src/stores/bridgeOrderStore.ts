import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * bridgeOrderStore — the user's manual order for the Bridge Project Rail (by
 * project path). Manual order FULLY wins: once set, the rail never auto-resorts by
 * urgency (urgency stays visible via the row's red/amber dot). Projects not yet in
 * `order` are appended; vanished projects are ignored. Persisted (localStorage).
 */
interface BridgeOrderState {
  order: string[];
  /** Reorder: place dragId just before dropId. `currentIds` is the full rendered
   *  order right now — used to SEED `order` the first time so a single drag doesn't
   *  strand the rest. */
  reorder: (currentIds: string[], dragId: string, dropId: string) => void;
}

export const useBridgeOrderStore = create<BridgeOrderState>()(
  persist(
    (set, get) => ({
      order: [],
      reorder: (currentIds, dragId, dropId) => {
        if (dragId === dropId) return;
        // Seed from the current full order (so previously-unordered projects keep
        // their place), then move dragId to just before dropId.
        const seen = new Set<string>();
        const ids: string[] = [];
        for (const id of [...get().order, ...currentIds]) {
          if (currentIds.includes(id) && !seen.has(id)) { ids.push(id); seen.add(id); }
        }
        const from = ids.indexOf(dragId);
        if (from === -1) return;
        ids.splice(from, 1);
        const to = ids.indexOf(dropId);
        ids.splice(to === -1 ? ids.length : to, 0, dragId);
        set({ order: ids });
      },
    }),
    { name: 'mc.bridge.projectOrder.v1', version: 1 },
  ),
);

/**
 * Apply the manual order to a project list: ordered entries first (in saved
 * order), then any not-yet-ordered projects appended in the given fallback order.
 */
export function applyBridgeOrder<T extends { project: string }>(projects: T[], order: string[]): T[] {
  const byPath = new Map(projects.map((p) => [p.project, p]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const p = byPath.get(path);
    if (p && !seen.has(path)) { out.push(p); seen.add(path); }
  }
  for (const p of projects) if (!seen.has(p.project)) { out.push(p); seen.add(p.project); }
  return out;
}
