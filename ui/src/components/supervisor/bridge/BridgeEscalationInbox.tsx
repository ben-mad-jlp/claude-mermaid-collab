/**
 * BridgeEscalationInbox — the #1 KPI citizen (Control-UI vision §4, KPI #1).
 *
 * Decision cards, scoped to the active project: question, source worker,
 * structured options[] with ★recommended, answered in place via
 * decideEscalation OR Jump-to-worker. Pulses while > 0. Reuses the
 * structured-decision card treatment from ProjectScopeSection (L436–476).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';

/** True when focus is in a field where the answer-and-advance keys must not fire. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export interface BridgeEscalationInboxProps {
  escalations: Escalation[];
  serverScope: string;
  onJump?: (project: string, session: string) => void;
}

export const BridgeEscalationInbox: React.FC<BridgeEscalationInboxProps> = ({
  escalations,
  serverScope,
  onJump,
}) => {
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const confirmSuggestion = useSupervisorStore((s) => s.confirmSuggestion);
  const dismissSuggestion = useSupervisorStore((s) => s.dismissSuggestion);

  const open = escalations.filter((e) => e.status === 'open');

  // Answer-and-advance: keyboard drives the FIRST open card. Digits pick an
  // option, ↵ takes the ★recommended (or the only option), J jumps to the
  // worker. Answering removes the card from `open`, so the keys naturally fall
  // through to the next one.
  const [activeIdx, setActiveIdx] = useState(0);
  const clampedActive = open.length > 0 ? Math.min(activeIdx, open.length - 1) : 0;

  // Keep latest values in a ref so the window listener stays stable.
  const stateRef = useRef({ open, clampedActive, serverScope, onJump, decideEscalation });
  stateRef.current = { open, clampedActive, serverScope, onJump, decideEscalation };

  useEffect(() => {
    if (open.length === 0) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      const { open: cur, clampedActive: idx, serverScope: scope, onJump: jump, decideEscalation: decide } = stateRef.current;
      const active = cur[idx];
      if (!active) return;
      const opts = active.options ?? [];

      if (/^[1-9]$/.test(ev.key)) {
        const i = Number(ev.key) - 1;
        if (opts[i]) {
          ev.preventDefault();
          void decide(scope, active.id, opts[i].id);
          setActiveIdx(0);
        }
        return;
      }
      if (ev.key === 'Enter') {
        const pick = opts.find((o) => o.id === active.recommended) ?? (opts.length === 1 ? opts[0] : undefined);
        if (pick) {
          ev.preventDefault();
          void decide(scope, active.id, pick.id);
          setActiveIdx(0);
        }
        return;
      }
      if (ev.key === 'j' || ev.key === 'J') {
        if (jump) {
          ev.preventDefault();
          jump(active.project, active.session);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open.length]);

  return (
    <div
      data-testid="bridge-escalation-inbox"
      className={`rounded-lg border p-3 space-y-3 ${
        open.length > 0
          ? 'border-danger-300 dark:border-danger-700 bg-danger-50/60 dark:bg-danger-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">⚠ Escalation Inbox</span>
        <span
          className={`text-2xs font-bold px-1.5 rounded-full ${
            open.length > 0 ? 'bg-danger-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          {open.length}
        </span>
      </div>

      {open.length === 0 ? (
        <p className="text-2xs text-gray-500 dark:text-gray-400">✓ No open escalations — all clear.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {open.map((e, idx) => {
            const hasOptions = !!e.options && e.options.length > 0;
            const isActive = idx === clampedActive;
            return (
              <div
                key={e.id}
                onMouseEnter={() => setActiveIdx(idx)}
                data-active={isActive || undefined}
                className={`px-3 py-2.5 rounded border bg-white dark:bg-gray-800/60 space-y-2 ${
                  isActive
                    ? 'border-accent-400 dark:border-accent-600 ring-1 ring-accent-300 dark:ring-accent-700'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-3xs font-medium text-gray-500 dark:text-gray-400 truncate" title={`${e.project} / ${e.session}`}>
                    {e.session}
                  </span>
                  {/* Steward provenance (Steward P3): the steward triaged this and
                      routed it on to you — distinguishes triaged-and-deferred from
                      never-seen. Derived from the server's routedTo flip. */}
                  {e.routedTo === 'steward' && (
                    <span
                      data-testid="steward-provenance-tag"
                      title="The steward triaged this and sent it to you"
                      className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-3xs font-medium bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300"
                    >
                      🛡 steward sent this
                    </span>
                  )}
                  {onJump && (
                    <button
                      type="button"
                      onClick={() => onJump(e.project, e.session)}
                      className="ml-auto px-1.5 py-0.5 text-3xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title="Jump to session"
                    >
                      Jump
                    </button>
                  )}
                </div>
                <div className="text-xs leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                  {e.questionText}
                </div>
                {/* Orch P2: inline Grok-suggested action (level `propose`). Amber
                    (one-red discipline: red stays the escalation). verb→Confirm
                    runs the server proof gate; classify-only just routes attention. */}
                {e.suggestedAction && (
                  <div
                    data-testid="escalation-suggestion"
                    data-bucket={e.suggestedAction.bucket}
                    className="mt-1 rounded border border-warning-300 dark:border-warning-700 bg-warning-50/70 dark:bg-warning-900/20 px-2.5 py-2 space-y-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xs">🤖</span>
                      <span className="text-2xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-300">
                        {e.suggestedAction.bucket}
                      </span>
                      <span className="text-2xs text-gray-400 dark:text-gray-500" title="Grok confidence">
                        {Math.round((e.suggestedAction.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                    <div className="text-2xs leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                      {e.suggestedAction.rationale}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {e.suggestedAction.verb ? (
                        <button
                          type="button"
                          data-testid="suggestion-confirm"
                          onClick={() => void confirmSuggestion(serverScope, e.project, e.id)}
                          title={`Confirm — server re-validates the proof, then runs ${e.suggestedAction.verb}`}
                          className="px-2 py-1 text-2xs font-medium rounded bg-warning-500 text-white hover:bg-warning-600 transition-colors"
                        >
                          Confirm {e.suggestedAction.verb}
                        </button>
                      ) : (
                        <span className="text-2xs italic text-gray-500 dark:text-gray-400">classify-only — decide below</span>
                      )}
                      <button
                        type="button"
                        data-testid="suggestion-dismiss"
                        onClick={() => void dismissSuggestion(serverScope, e.project, e.id)}
                        className="px-2 py-1 text-2xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title="Dismiss the suggestion (the escalation stays open)"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                {hasOptions ? (
                  <div className="space-y-1.5 pt-1">
                    {e.options!.map((opt, optIdx) => {
                      const recommended = e.recommended === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => void decideEscalation(serverScope, e.id, opt.id)}
                          title={opt.detail ? `${opt.label} — ${opt.detail}` : opt.label}
                          className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded text-left text-2xs transition-colors border ${
                            recommended
                              ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100 dark:hover:bg-accent-900/50'
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {isActive && optIdx < 9 && (
                            <span className="shrink-0 mt-px inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-3xs font-mono font-semibold leading-none">
                              {optIdx + 1}
                            </span>
                          )}
                          <span className="flex-1 min-w-0">
                            <span className="font-medium leading-tight">{opt.label}</span>
                            {recommended && (
                              <span className="ml-1 text-3xs font-semibold text-accent-600 dark:text-accent-400">★ recommended ↵</span>
                            )}
                            {opt.detail && (
                              <span className="block text-3xs text-gray-500 dark:text-gray-400 leading-tight whitespace-pre-wrap break-words">
                                {opt.detail}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void resolveEscalation(serverScope, e.id, 'resolved')}
                      className="px-2 py-1 text-2xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Mark resolved"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-3xs text-gray-400 dark:text-gray-500 px-0.5 pt-1">
            <kbd className="font-mono">1–9</kbd> answer · <kbd className="font-mono">↵</kbd> ★recommended · <kbd className="font-mono">J</kbd> jump
          </p>
        </div>
      )}
    </div>
  );
};
