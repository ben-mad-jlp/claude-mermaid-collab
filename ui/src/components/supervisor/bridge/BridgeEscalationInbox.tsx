/**
 * BridgeEscalationInbox — the #1 KPI citizen (Control-UI vision §4, KPI #1).
 *
 * Decision cards, scoped to the active project: question, source worker,
 * structured options[] with ★recommended, answered in place via
 * decideEscalation OR Jump-to-worker. Pulses while > 0. Reuses the
 * structured-decision card treatment from ProjectScopeSection (L436–476).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';
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
        title="An AI triage consult is in flight for this escalation"
        className="shrink-0 inline-flex items-center gap-1 px-1 py-0.5 rounded text-3xs font-medium bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300"
      >
        <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" aria-hidden="true" />
        AI is triaging…
      </span>
    );
  }
  if (state === 'escalated-to-human') {
    return (
      <span
        data-testid="triage-lifecycle-badge"
        data-state="escalated-to-human"
        title="AI tried to triage this and could not resolve it — it needs you"
        className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-3xs font-medium bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300"
      >
        🛡 needs you — AI couldn’t resolve
      </span>
    );
  }
  return null;
};

export interface BridgeEscalationInboxProps {
  escalations: Escalation[];
  serverScope: string;
  /** 'escalation' (red, "needs you") or 'land' (blue, positive "ready to land"). */
  variant?: 'escalation' | 'land';
  /** Drop the card container + header chrome and render just the list (the tab
   *  already shows the title + count). Used when embedded in a Bridge tab. */
  bare?: boolean;
  onJump?: (project: string, session: string) => void;
  /** When set, recently AI-resolved escalations for this project linger briefly
   *  with their outcome (fd934fb7) instead of silently vanishing. Omit to hide the
   *  lingering section (callers that can't scope it). */
  project?: string;
  /** Open the escalation's linked todo (surfaces the work the question is about). */
  onSelectTodo?: (todo: SessionTodo) => void;
}

/** Terminal statuses — a todo here is finished and gets no re-ready/block actions. */
const TERMINAL_TODO = new Set(['done', 'dropped']);

export const BridgeEscalationInbox: React.FC<BridgeEscalationInboxProps> = ({
  escalations,
  serverScope,
  variant = 'escalation',
  bare = false,
  onJump,
  project,
  onSelectTodo,
}) => {
  const isLand = variant === 'land';
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);
  const confirmSuggestion = useSupervisorStore((s) => s.confirmSuggestion);
  const dismissSuggestion = useSupervisorStore((s) => s.dismissSuggestion);
  const resolvedEscalations = useSupervisorStore((s) => s.resolvedEscalations);
  const promoteTodo = useSupervisorStore((s) => s.promoteTodo);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);

  const open = escalations.filter((e) => e.status === 'open');

  // Index this project's todos so a card can show + act on the work it links to.
  const todoById = useMemo(() => {
    const m = new Map<string, SessionTodo>();
    for (const t of todosByProject[project ?? ''] ?? []) m.set(t.id, t);
    return m;
  }, [todosByProject, project]);

  // Dismiss an escalation, optionally setting its linked todo's status (re-ready so
  // the orchestrator re-picks it, or block when it needs a human). Default: leave
  // the todo untouched — the status only changes when a disposition is chosen.
  const resolveWith = async (e: Escalation, disposition?: 'ready' | 'blocked') => {
    await resolveEscalation(serverScope, e.id, 'resolved');
    if (disposition && e.todoId) await promoteTodo(serverScope, e.project, e.todoId, disposition);
  };

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

  return (
    <div
      data-testid="bridge-escalation-inbox"
      className={
        bare
          ? 'space-y-3'
          : `rounded-lg border p-3 space-y-3 ${
              open.length === 0
                ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                : isLand
                  ? 'border-info-300 dark:border-info-700 bg-info-50/60 dark:bg-info-900/20'
                  : 'border-danger-300 dark:border-danger-700 bg-danger-50/60 dark:bg-danger-900/20'
            }`
      }
    >
      {!bare && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{isLand ? '⬇ Ready to Land' : '⚠ Escalation Inbox'}</span>
          <span
            className={`text-2xs font-bold px-1.5 rounded-full ${
              open.length === 0
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                : isLand
                  ? 'bg-info-500 text-white'
                  : 'bg-danger-500 text-white'
            }`}
          >
            {open.length}
          </span>
        </div>
      )}

      {open.length === 0 ? (
        bare ? null : <p className="text-2xs text-gray-500 dark:text-gray-400">{isLand ? '✓ Nothing to land — all merged.' : '✓ No open escalations — all clear.'}</p>
      ) : (
        <div className={bare ? 'space-y-2' : 'space-y-2 max-h-72 overflow-y-auto'}>
          {open.map((e) => {
            const hasOptions = !!e.options && e.options.length > 0;
            const todo = e.todoId ? todoById.get(e.todoId) : undefined;
            const todoActive = todo && !TERMINAL_TODO.has(todo.status);
            return (
              <div
                key={e.id}
                className="px-3 py-2.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 space-y-2"
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
                {/* Linked todo (#1): the work this question is about. Click to open it
                    in the detail tab. Shows its current status so the human has context. */}
                {todo && (
                  <button
                    type="button"
                    data-testid="escalation-linked-todo"
                    onClick={onSelectTodo ? () => onSelectTodo(todo) : undefined}
                    title={onSelectTodo ? `Open todo: ${todo.title}` : todo.title}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 text-left ${
                      onSelectTodo ? 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span className="text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500 shrink-0">todo</span>
                    <span className="flex-1 min-w-0 truncate text-2xs text-gray-700 dark:text-gray-200">{todo.title}</span>
                    <span className="shrink-0 text-3xs px-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{todo.status}</span>
                  </button>
                )}
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
                      <span className="text-2xs text-gray-400 dark:text-gray-500" title="AI confidence">
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
                    {e.options!.map((opt) => {
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
                          <span className="flex-1 min-w-0">
                            <span className="font-medium leading-tight">{opt.label}</span>
                            {recommended && (
                              <span className="ml-1 text-3xs font-semibold text-accent-600 dark:text-accent-400">★ recommended</span>
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
                      className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                      title="Re-derive land-readiness server-side, then merge this epic onto master"
                    >
                      {/* download glyph = 'ship to master' — the same icon the project
                          cards + Land tab use (replaces the old rocket). */}
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M10 2a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 10.586V3a1 1 0 011-1z" />
                        <path d="M3 14a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
                      </svg>
                      Land
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
                  // Dismiss clears the card. With a linked, non-terminal todo (#2) the
                  // human can also choose its fate: re-ready (orchestrator re-picks it)
                  // or block (needs a human). Plain Dismiss leaves the todo untouched.
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void resolveWith(e)}
                      className="px-2 py-1 text-2xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Dismiss — clear this escalation, leave the linked todo as-is"
                    >
                      Dismiss
                    </button>
                    {todoActive && (
                      <>
                        <button
                          type="button"
                          data-testid="dismiss-reready-todo"
                          onClick={() => void resolveWith(e, 'ready')}
                          className="px-2 py-1 text-2xs font-medium rounded bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50 transition-colors"
                          title="Dismiss + set the linked todo back to ready so the orchestrator re-picks it"
                        >
                          Dismiss + re-ready todo
                        </button>
                        <button
                          type="button"
                          data-testid="dismiss-block-todo"
                          onClick={() => void resolveWith(e, 'blocked')}
                          className="px-2 py-1 text-2xs font-medium rounded bg-warning-100 text-warning-700 hover:bg-warning-200 dark:bg-warning-900/30 dark:text-warning-300 dark:hover:bg-warning-900/50 transition-colors"
                          title="Dismiss + mark the linked todo blocked (needs a human)"
                        >
                          Dismiss + block todo
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
