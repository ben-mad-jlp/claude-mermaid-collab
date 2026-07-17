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
   * A MACRO chip: submit each string in order as its own input (instead of `text`).
   * Each is sent + Enter sequentially with a small gap so the CLI's input queue
   * serialises them (a queued `/clear` only runs after `/vibe-checkpoint`'s turn
   * finishes — see InputRail.sendChip). `{{session}}` is interpolated at click time.
   * Macro chips ignore `compose` (always submit).
   */
  sequence?: string[];
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
  {
    id: 'checkpoint-reload',
    label: '⏎ ckpt+reload',
    // The common checkpoint → clear → re-register loop, queued as 3 inputs.
    sequence: ['/vibe-checkpoint', '/clear', '/collab {{session}}'],
  },
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

/**
 * The unified, ordered chip list: visible defaults + custom, arranged by `order`,
 * with any chips missing from `order` appended (defaults first, then custom) for a
 * stable result across new defaults / freshly-added custom chips. This is the rail
 * render order AND the Ctrl+F# assignment order.
 */
export function computeOrderedChips(
  custom: Chip[],
  hiddenDefaults: string[],
  order: string[],
): Chip[] {
  const byId = new Map<string, Chip>();
  for (const d of DEFAULT_CHIPS) if (!hiddenDefaults.includes(d.id)) byId.set(d.id, d);
  for (const c of custom) byId.set(c.id, c);
  const result: Chip[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const chip = byId.get(id);
    if (chip && !seen.has(id)) { result.push(chip); seen.add(id); }
  }
  for (const d of DEFAULT_CHIPS) if (byId.has(d.id) && !seen.has(d.id)) { result.push(byId.get(d.id)!); seen.add(d.id); }
  for (const c of custom) if (!seen.has(c.id)) { result.push(c); seen.add(c.id); }
  return result;
}

export interface ChipInput {
  label: string;
  text?: string;
  compose?: boolean;
}

interface QuickReplyState {
  /** Power-user state — rail collapsed to a hairline (not surfaced by default). */
  collapsed: boolean;
  /** Ids of default chips the user deleted (defaults are code-defined, so "delete"
   *  = hide from the rail; re-derivable, never destroys a code default). */
  hiddenDefaults: string[];
  /** The user's custom chips. */
  custom: Chip[];
  /** Explicit display order across ALL chips (defaults + custom) by id. Drives the
   *  rail order AND the Ctrl+F# assignment. Ids not present are appended (new
   *  defaults/custom); ids no longer existing are ignored. */
  order: string[];

  addChip: (input: ChipInput) => void;
  editChip: (id: string, patch: Partial<ChipInput>) => void;
  /** Delete any chip — a custom chip is removed; a default is hidden. */
  deleteChip: (id: string) => void;
  /** Reorder ANY chip (default or custom): place dragId just before dropId in the
   *  unified display order (which is also the Ctrl+F# order). */
  moveChip: (dragId: string, dropId: string) => void;
  toggleCompose: (id: string) => void;
  hideDefault: (id: string) => void;
  unhideDefault: (id: string) => void;
  toggleCollapsed: () => void;
  /** Composer: Enter sends (Shift+Enter = newline) when true; Enter inserts a
   *  newline and only the Send button / ⌘↵ submits when false. Persisted. */
  sendOnEnter: boolean;
  setSendOnEnter: (on: boolean) => void;
  /** Terminal theme: 'match' follows the collab app theme; light/dark/sepia pin it.
   *  Drives the xterm palette AND the chip bar + composer chrome. Persisted. */
  terminalTheme: TerminalThemeSetting;
  setTerminalTheme: (t: TerminalThemeSetting) => void;
  /** Suggestion (quick-reply) chip row display: on = InputRail renders its chips (default);
   *  off = InputRail hides the chip row entirely. Generation/state (custom chips, order,
   *  hiddenDefaults) is untouched either way — this is purely a display gate. Persisted. */
  suggestReplyDisplay: boolean;
  setSuggestReplyDisplay: (on: boolean) => void;
}

export type TerminalThemeSetting = 'match' | 'light' | 'dark' | 'sepia';

export const useQuickReplyStore = create<QuickReplyState>()(
  persist(
    (set) => ({
      collapsed: false,
      hiddenDefaults: [],
      custom: [],
      order: [],

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
          // Append the new chip to the end of the unified order.
          const ids = computeOrderedChips([...s.custom, chip], s.hiddenDefaults, s.order).map((c) => c.id);
          return { custom: [...s.custom, chip], order: ids };
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

      deleteChip: (id) =>
        set((s) => {
          // A default is code-defined → "delete" = hide it; a custom chip is removed.
          const isDefault = DEFAULT_IDS.has(id);
          const custom = isDefault ? s.custom : s.custom.filter((c) => c.id !== id);
          const hiddenDefaults = isDefault && !s.hiddenDefaults.includes(id)
            ? [...s.hiddenDefaults, id]
            : s.hiddenDefaults;
          const order = s.order.filter((x) => x !== id);
          return { custom, hiddenDefaults, order };
        }),

      moveChip: (dragId, dropId) => {
        if (dragId === dropId) return;
        set((s) => {
          // Operate on the full unified order (defaults + custom), normalising it
          // first so a pre-`order` (migrated) state reorders correctly.
          const ids = computeOrderedChips(s.custom, s.hiddenDefaults, s.order).map((c) => c.id);
          const from = ids.indexOf(dragId);
          const to = ids.indexOf(dropId);
          if (from === -1 || to === -1) return s;
          ids.splice(from, 1);
          ids.splice(ids.indexOf(dropId), 0, dragId);
          return { order: ids };
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

      sendOnEnter: true,
      setSendOnEnter: (on) => set({ sendOnEnter: on }),

      terminalTheme: 'match',
      setTerminalTheme: (t) => set({ terminalTheme: t }),

      suggestReplyDisplay: true,
      setSuggestReplyDisplay: (on) => set({ suggestReplyDisplay: on }),
    }),
    {
      name: 'mc.terminal.chips.v1',
      version: 3,
      // Older persisted blobs may carry a now-removed `autocorrectMode`; strip it
      // and keep the rest (chips, order, toggles) so upgrading loses no user data.
      migrate: (persisted: any) => {
        if (persisted && 'autocorrectMode' in persisted) {
          delete persisted.autocorrectMode;
        }
        return persisted;
      },
      // Persist only the deltas — defaults are code-defined and re-derived.
      partialize: (s) => ({
        collapsed: s.collapsed,
        hiddenDefaults: s.hiddenDefaults,
        custom: s.custom,
        order: s.order,
        sendOnEnter: s.sendOnEnter,
        terminalTheme: s.terminalTheme,
        suggestReplyDisplay: s.suggestReplyDisplay,
      }),
    },
  ),
);
