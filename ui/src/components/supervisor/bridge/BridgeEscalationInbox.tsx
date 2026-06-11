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
import { classifyEscalationLifecycle, selectRecentlyAiResolved } from '@/lib/escalationLifecycle';

/**
 * Lifecycle badge for an OPEN escalation (todo fd934fb7): makes the triage state
 * explicit so an escalation never looks untouched while Grok is on it, and a
 * Grok-couldn't-resolve one is clearly flagged "needs you" rather than blending in.
 * Pure read off the shared classifier so the left column and Bridge agree.
 */
const TriageLifecycleBadge: React.FC<{ escalation: Escalation }> = ({ escalation }) => {
  const state = classifyEscalationLifecycle(escalation);
  if (state === 'ai-handling') {
    return (
      <span
        data-testid="triage-lifecycle-badge"
        data-state="ai-handling"
        title="A Grok triage consult is in flight for this escalation"
        className="shrink-0 inline-flex items-center gap-1 px-1 py-0.5 rounded text-3xs font-medium bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300"
      >
        <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" aria-hidden="true" />
        Grok is triaging…
      </span>
    );
  }
  if (state === 'escalated-to-human') {
    return (
      <span
        data-testid="triage-lifecycle-badge"
        data-state="escalated-to-human"
        title="Grok tried to triage this and could not resolve it — it needs you"
        className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-3xs font-medium bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300"
      >
        🛡 needs you — AI couldn’t resolve
      </span>
    );
  }
  return null;
};

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
  /** When set, recently AI-resolved escalations for this project linger briefly
   *  with their outcome (fd934fb7) instead of silently vanishing. Omit to hide the
   *  lingering section (callers that can't scope it). */
  project?: string;
}

export const BridgeEscalationInbox: React.FC<BridgeEscalationInboxProps> = ({
  escalations,
  serverScope,
  onJump,
  project,
}) => {
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);
  const confirmSuggestion = useSupervisorStore((s) => s.confirmSuggestion);
  const dismissSuggestion = useSupervisorStore((s) => s.dismissSuggestion);
  const resolvedEscalations = useSupervisorStore((s) => s.resolvedEscalations);

  const open = escalations.filter((e) => e.status === 'open');

  // Lingering AI-resolved cards (fd934fb7): a steward auto-resolve should show its
  // outcome for a short window, not vanish. A coarse clock tick ages them out
  // (a UI fade timer, NOT data polling — the data already arrived via WS).
  const [nowTick, setNowTick] = useState(() => Date.now());
  const recentlyAiResolved = project
    ? selectRecentlyAiResolved(
        resolvedEscalations.filter((e) => e.project === project),
        nowTick,
      )
    : [];
  useEffect(() => {
    if (recentlyAiResolved.length === 0) return;
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [recentlyAiResolved.length]);

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
                  {/* Triage lifecycle (fd934fb7): in-flight Grok consult, or a
                      Grok-tried-and-deferred "needs you" flag. Supersedes the old
                      bare steward-provenance tag — derived from the same server
                      facts (routedTo / stewardAttempts / triageInFlight) via the
                      shared classifier so the left column and Bridge never disagree. */}
                  <TriageLifecycleBadge escalation={e} />
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
                ) : e.kind === 'epic-ready-to-land' ? (
                  // LAND card (epic-landing P3): primary action is LAND (merge to
                  // master via the server proof gate), NOT the destructive Resolve —
                  // resolving would dismiss the card and strand the work off-master.
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void landEpic(serverScope, e.project, e.id)}
                      className="px-2 py-1 text-2xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                      title="Re-derive land-readiness server-side, then merge this epic onto master"
                    >
                      🚀 Land
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveEscalation(serverScope, e.id, 'resolved')}
                      className="px-2 py-1 text-2xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Dismiss without landing (the work stays on its epic branch)"
                    >
                      Dismiss
                    </button>
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

      {/* Lingering AI-resolved cards (fd934fb7): a steward auto-resolve shows its
          outcome + rationale here for a short window so it doesn't silently vanish.
          Muted (one-red discipline — these are done, not actionable). */}
      {recentlyAiResolved.length > 0 && (
        <div data-testid="ai-resolved-recent" className="space-y-1.5 pt-1 border-t border-gray-200 dark:border-gray-700">
          <span className="text-3xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Recently resolved by AI
          </span>
          {recentlyAiResolved.map((e) => (
            <div
              key={e.id}
              data-testid="ai-resolved-card"
              className="px-2.5 py-1.5 rounded border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-900/15 opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-2xs">✓</span>
                <span className="text-3xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  AI resolved
                </span>
                <span className="text-3xs text-gray-400 dark:text-gray-500 truncate" title={`${e.project} / ${e.session}`}>
                  {e.session}
                </span>
              </div>
              <div className="text-3xs leading-snug text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2 break-words">
                {e.suggestedAction?.rationale ?? e.questionText}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
