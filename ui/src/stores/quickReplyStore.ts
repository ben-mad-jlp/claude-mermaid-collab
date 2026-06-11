import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * quickReplyStore — client-local state for the terminal quick-reply chip bar
 * (InputRail). QR2 adds custom chips + management on top of QR1's defaults-only
 * tap-to-send rail.
 *
 * Scope is GLOBAL across all terminals (no per-project/per-session split in v1):
 * the reusable answers (`1`, `yes`, `continue`, `do your recommendation`) are
 * conversational primitives, identical in every project — per-project would force
 * re-authoring the same chips per repo (design §3b, Grok §5 synthesis).
 *
 * Defaults are CODE-DEFINED and never persisted (ship new defaults without a
 * migration). localStorage (`mc.terminal.chips.v1`) holds only the deltas:
 * { version, collapsed, hiddenDefaults, custom }. `send` is intentionally NOT in
 * the store — the dispatch lives in the component (it needs the live attached
 * session); this store is pure client-local state with no WS events.
 */

export interface Chip {
  id: string;
  /** Chip face. */
  label: string;
  /** Injected payload; defaults to `label` (`text ??= label`). */
  text?: string;
  /** false/undefined = filled/send chip; true = outlined+caret/stage-for-edit. */
  compose?: boolean;
  /**
   * Reserved for v2 per-project scoping (design §3b) — only 'global' in v1.
   * Noted, not built: the rail renders every custom chip regardless today.
   */
  scope?: 'global';
}

/** Code-defined defaults — NOT persisted (ship new defaults without a migration). */
export const DEFAULT_CHIPS: Chip[] = [
  { id: '1', label: '1' },
  { id: '2', label: '2' },
  { id: '3', label: '3' },
  { id: '4', label: '4' },
  { id: '5', label: '5' },
  { id: 'yes', label: 'yes' },
  { id: 'no', label: 'no' },
  { id: 'continue', label: 'continue' },
  { id: 'stop', label: 'stop' },
  { id: 'reco', label: 'do-reco', text: 'do your recommendation' },
];

const DEFAULT_IDS = new Set(DEFAULT_CHIPS.map((c) => c.id));

/** Stable-ish client id for a user chip. */
function newChipId(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `c_${uuid.replace(/-/g, '').slice(0, 8)}`;
}

export interface ChipInput {
  label: string;
  text?: string;
  compose?: boolean;
}

interface QuickReplyState {
  /** Power-user state — rail collapsed to a hairline (not surfaced by default). */
  collapsed: boolean;
  /** Ids of default chips the user hid (right-click → Hide). */
  hiddenDefaults: string[];
  /** The user's custom chips, in display order (after the visible defaults). */
  custom: Chip[];

  addChip: (input: ChipInput) => void;
  editChip: (id: string, patch: Partial<ChipInput>) => void;
  deleteChip: (id: string) => void;
  /** Reorder a custom chip, mirroring terminalStore.moveTab. */
  moveChip: (dragId: string, dropId: string) => void;
  toggleCompose: (id: string) => void;
  hideDefault: (id: string) => void;
  unhideDefault: (id: string) => void;
  toggleCollapsed: () => void;
}

export const useQuickReplyStore = create<QuickReplyState>()(
  persist(
    (set) => ({
      collapsed: false,
      hiddenDefaults: [],
      custom: [],

      addChip: (input) =>
        set((s) => {
          const label = input.label.trim();
          if (!label) return s;
          const text = input.text?.trim();
          const chip: Chip = {
            id: newChipId(),
            label,
            // Only store `text` when it differs from the label (text ??= label).
            ...(text && text !== label ? { text } : {}),
            ...(input.compose ? { compose: true } : {}),
          };
          return { custom: [...s.custom, chip] };
        }),

      editChip: (id, patch) =>
        set((s) => ({
          custom: s.custom.map((c) => {
            if (c.id !== id) return c;
            const label = patch.label !== undefined ? patch.label.trim() : c.label;
            if (!label) return c;
            const rawText = patch.text !== undefined ? patch.text?.trim() : c.text;
            const compose = patch.compose !== undefined ? patch.compose : c.compose;
            const next: Chip = { id: c.id, label };
            if (rawText && rawText !== label) next.text = rawText;
            if (compose) next.compose = true;
            return next;
          }),
        })),

      deleteChip: (id) => set((s) => ({ custom: s.custom.filter((c) => c.id !== id) })),

      moveChip: (dragId, dropId) => {
        if (dragId === dropId) return;
        set((s) => {
          const from = s.custom.findIndex((c) => c.id === dragId);
          const to = s.custom.findIndex((c) => c.id === dropId);
          if (from === -1 || to === -1) return s;
          const next = [...s.custom];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { custom: next };
        });
      },

      toggleCompose: (id) =>
        set((s) => ({
          custom: s.custom.map((c) => (c.id === id ? { ...c, compose: !c.compose } : c)),
        })),

      hideDefault: (id) =>
        set((s) =>
          !DEFAULT_IDS.has(id) || s.hiddenDefaults.includes(id)
            ? s
            : { hiddenDefaults: [...s.hiddenDefaults, id] },
        ),

      unhideDefault: (id) =>
        set((s) => ({ hiddenDefaults: s.hiddenDefaults.filter((x) => x !== id) })),

      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    {
      name: 'mc.terminal.chips.v1',
      version: 1,
      // Persist only the deltas — defaults are code-defined and re-derived.
      partialize: (s) => ({
        collapsed: s.collapsed,
        hiddenDefaults: s.hiddenDefaults,
        custom: s.custom,
      }),
    },
  ),
);
