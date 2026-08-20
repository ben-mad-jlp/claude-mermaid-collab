/**
 * One off/on OPERATOR LEVER stop, in the ladder's own idiom: a stroked 24-viewBox icon +
 * the current level, one click to flip, disabled while the write is in flight, and the
 * failure surfaced INLINE (never a modal, never a silent flip).
 *
 * Shared by AutoFix (holds the repair forge) and Explorer (holds explore dispatch): both
 * are per-project off/on switches with an identical contract, default 'on'.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { type LeverLevel } from '@/lib/conductorActivity';

export type { LeverLevel } from '@/lib/conductorActivity';

export interface LeverStopProps {
  /** data-testid prefix: `<testId>-toggle`, `<testId>-level`, `<testId>-error`. */
  testId: string;
  label: string;
  project: string;
  fetchLevel?: (project: string) => Promise<{ ok: boolean; level: LeverLevel; error?: string }>;
  postLevel?: (project: string, level: LeverLevel) => Promise<{ ok: boolean; level?: LeverLevel; error?: string }>;
  /** Word used in the generic failure line when the server sends no message. */
  failLabel: string;
  titleOn: string;
  titleOff: string;
  /** SVG children, drawn inside the shared stroked 24-viewBox frame. */
  icon: React.ReactNode;
  disabled?: boolean;
  disabledTitle?: string;
  /** Presence (including `null`) selects controlled mode — parent owns the value. */
  controlledLevel?: LeverLevel | null;
  onFlip?: (next: LeverLevel) => Promise<{ ok: boolean; level?: LeverLevel; error?: string }>;
}

export const LeverStop: React.FC<LeverStopProps> = ({
  testId, label, project, fetchLevel, postLevel, failLabel, titleOn, titleOff, icon,
  disabled, disabledTitle, controlledLevel, onFlip,
}) => {
  const controlled = controlledLevel !== undefined;
  const [level, setLevel] = useState<LeverLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = controlled ? controlledLevel : level;

  // Read the CURRENT level on mount (and whenever the project changes).
  // Controlled mode skips the fetch — the parent supplies the value.
  useEffect(() => {
    if (controlled || !fetchLevel) return;
    if (!project) return;
    let cancelled = false;
    void fetchLevel(project).then((r) => {
      if (cancelled) return;
      setLevel(r.level);
      if (!r.ok) setError(r.error ?? `${failLabel} read failed`);
    });
    return () => { cancelled = true; };
  }, [project, fetchLevel, failLabel, controlled]);

  const handleClick = useCallback(async () => {
    if (busy || disabled || !project || shown === null) return;
    const next: LeverLevel = shown === 'on' ? 'off' : 'on';
    setBusy(true);
    setError(null);
    if (controlled) {
      if (onFlip) {
        const r = await onFlip(next);
        // Parent owns the value — do not write internal level on ok.
        if (!r.ok) setError(r.error ?? `${failLabel} failed`);
      }
    } else {
      const r = await postLevel!(project, next);
      // Adopt the SERVER's value, not the requested one — a refused write (transient path)
      // must not read back as a successful flip.
      if (r.ok) setLevel(r.level ?? next);
      else setError(r.error ?? `${failLabel} failed`);
    }
    setBusy(false);
  }, [busy, disabled, project, shown, controlled, controlledLevel, onFlip, postLevel, failLabel]);

  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        data-lever-level={shown ?? 'unknown'}
        data-lever-busy={String(busy)}
        disabled={busy || disabled || shown === null}
        aria-label={`${label} ${shown ?? 'loading'} — click to toggle`}
        onClick={() => { void handleClick(); }}
        title={error ? error : disabled && disabledTitle ? disabledTitle : shown === 'off' ? titleOff : titleOn}
        className={`px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${
          error ? 'text-danger-500' : shown === 'off' ? 'text-gray-400 dark:text-gray-500' : 'text-success-600 dark:text-success-500'
        } ${busy ? 'animate-pulse' : ''}`}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
        <span data-testid={`${testId}-level`}>{label} {shown ?? '…'}</span>
      </button>
      {/* Failure surfaces INLINE (no modal) so a refused/failed write can never read as a
          silent success on the switch itself. */}
      {error && (
        <span
          data-testid={`${testId}-error`}
          role="status"
          className="shrink-0 px-1.5 py-0.5 whitespace-nowrap border-l border-gray-300 dark:border-gray-600 text-danger-500"
        >
          {error}
        </span>
      )}
    </>
  );
};

export default LeverStop;
