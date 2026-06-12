/**
 * ProviderSelector (PAW P3) — a small dropdown to MANUALLY pin which provider a
 * session's workers run on (claude | grok-build | codex). Writing the session
 * provider PIN is the only thing routing reads; everything ships DORMANT, so with
 * the default ('claude') the pin is a no-op pass-through. There is NO automatic
 * cost routing and NO spend cap — this is an explicit human selection.
 *
 * The selector is intentionally presentation-only + controlled: it renders the
 * current pin and calls `onChange` with the chosen ProviderId. A host that has a
 * write path (a `POST /api/session/provider` style route persisting via
 * session-status-store.recordSessionProvider) wires `onChange` to it; until then
 * the component is a drop-in with no backend dependency.
 *
 * MOUNT POINT: the worker / watch card. The natural home is
 * `ui/src/components/supervisor/bridge/fleet/nodes/WorkerNode.tsx` (the live
 * worker card) at LOD ≥ 1, beside the session label — its `data.session` +
 * project identify the pin target. Mounting there needs (a) the FleetEntry
 * `provider` field (added in src/services/fleet-status.ts) threaded into
 * WorkerNodeData, and (b) a write route calling recordSessionProvider. Both are
 * small follow-ups; the component itself is ready to drop in.
 */

import React from 'react';

/** Mirrors src/agent/worker-agent.ts ProviderId. Kept as a literal union here so
 *  the UI bundle has no server-type import; keep in lockstep if ids change. */
export type ProviderId = 'claude' | 'grok-build' | 'codex';

/** The selectable providers, in display order. `claude` is the default/floor. */
export const PROVIDER_OPTIONS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'grok-build', label: 'Grok (build)' },
  { id: 'codex', label: 'Codex' },
] as const;

export const DEFAULT_PROVIDER: ProviderId = 'claude';

export interface ProviderSelectorProps {
  /** Current pin. Undefined/null ⇒ the default ('claude', pass-through). */
  value?: ProviderId | null;
  /** Called with the newly selected provider. Wire this to the session-provider
   *  write path (recordSessionProvider on the server). */
  onChange: (provider: ProviderId) => void;
  /** Optional: disable while a write is in flight. */
  disabled?: boolean;
  /** Optional extra classes for layout in a host card. */
  className?: string;
  /** Accessible label; defaults to "Provider". */
  'aria-label'?: string;
}

/**
 * The dropdown. Small, unstyled-ish (inherits the card's theme tokens), and
 * controlled. Falls back to the default provider when no pin is set.
 */
export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  value,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel = 'Provider',
}) => {
  const current: ProviderId = value ?? DEFAULT_PROVIDER;
  return (
    <select
      aria-label={ariaLabel}
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ProviderId)}
      className={
        'text-xs rounded border border-gray-300 dark:border-gray-600 ' +
        'bg-white dark:bg-gray-900 px-1 py-0.5 ' +
        (className ?? '')
      }
    >
      {PROVIDER_OPTIONS.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};

export default ProviderSelector;
