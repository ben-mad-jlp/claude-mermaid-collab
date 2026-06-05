/**
 * ModePill — the top-level mode switch (Control-UI vision §2, §7).
 *
 * One control, top-left: [ ◫ Studio │ ⤢ Bridge │ ◑ Plan ] with a live
 * escalation count badge ⚠N that rides the pill in ALL three modes — the
 * single thread back to the fleet from inside a focused session.
 *
 * ⌘1 / ⌘2 / ⌘3 quick-switch between the three modes.
 *
 * This is the seam shipped first (CUI-1): it drives the App.tsx main-canvas
 * gate via `uiStore.mode`, replacing the old `supervisorViewOpen` boolean.
 */

import React, { useEffect } from 'react';
import { useUIStore, type UIMode } from '@/stores/uiStore';
import { CommandBarBadge } from '@/components/supervisor/bridge/CommandBarBadge';

interface ModeDef {
  key: UIMode;
  glyph: string;
  label: string;
}

const MODES: ModeDef[] = [
  { key: 'studio', glyph: '◫', label: 'Studio' },
  { key: 'bridge', glyph: '⤢', label: 'Bridge' },
  { key: 'plan', glyph: '◑', label: 'Plan' },
];

export const ModePill: React.FC = () => {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  // ⌘1 / ⌘2 / ⌘3 quick-switch (grafted from workspace-perspectives).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx === -1) return;
      e.preventDefault();
      setMode(MODES[idx].key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  return (
    <div
      data-testid="mode-pill"
      className="relative flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-0.5"
      role="tablist"
      aria-label="Workspace mode"
    >
      {MODES.map((m, i) => {
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`mode-pill-${m.key}`}
            onClick={() => setMode(m.key)}
            title={`${m.label} (⌘${i + 1})`}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              active
                ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <span aria-hidden="true">{m.glyph}</span>
            <span>{m.label}</span>
          </button>
        );
      })}

      {/* Escalation safety-net badge — the single project-scoped selector,
          calm-green at zero, red + clickable when a human is needed. Rides the
          pill in every mode (Bridge P1). */}
      <span className="ml-1 mr-0.5 flex items-center">
        <CommandBarBadge />
      </span>
    </div>
  );
};
