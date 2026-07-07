/**
 * DecisionCard — the focal, center-stage decision overlay (BR-4, design §4/§6).
 *
 * Rendered over a scrimmed deck. It branches three ways:
 *   1. escalation.ui (valid spec)  → <Renderer> over the closed catalog
 *   2. escalation.options[]         → today's A/B/C card (UNCHANGED treatment)
 *   3. neither                      → legacy Jump / Resolve
 * Behind the `jsonRenderDecisionCard` flag at the call site; the inline
 * BridgeEscalationInbox card is untouched.
 *
 * Answer-and-advance keyboard: 1–9 pick an option, ↵ takes the ★recommended,
 * J jumps to the worker, Esc closes. Answering closes the card (its node turns
 * green in the graph).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';
import { parseUiSpec } from './catalog';
import { Renderer } from './Renderer';
import { Markdown } from '@/components/ai-ui/display/Markdown';

export interface DecisionCardProps {
  escalation: Escalation;
  serverScope: string;
  onClose: () => void;
  onJump?: (project: string, session: string) => void;
}

interface Answerable {
  optionId: string;
  label: string;
  recommended: boolean;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({ escalation, serverScope, onClose, onJump }) => {
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);
  const fetchEscalationBrief = useSupervisorStore((s) => s.fetchEscalationBrief);

  // Deep markdown briefing (escalation-briefing epic): lazily fetched from the
  // server when this focal card opens, rendered ABOVE the raw structured context.
  // Cached in component state so re-renders don't re-fetch. Fails open: on error
  // we render nothing extra and the card still works.
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const loadBrief = React.useCallback(
    async (refresh: boolean) => {
      if (!escalation.project || !escalation.id) return;
      setBriefLoading(true);
      const res = await fetchEscalationBrief(serverScope, escalation.project, escalation.id, refresh);
      setBriefLoading(false);
      if (res) setBrief(res.md);
    },
    [fetchEscalationBrief, serverScope, escalation.project, escalation.id],
  );

  useEffect(() => {
    // Fetch on open / when the focal escalation changes. Skip if no project.
    setBrief(null);
    if (escalation.project) void loadBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escalation.id, escalation.project]);

  const spec = useMemo(() => parseUiSpec(escalation.ui), [escalation.ui]);
  const isLand = escalation.kind === 'epic-ready-to-land';

  const decide = (optionId: string) => {
    void decideEscalation(serverScope, escalation.id, optionId);
    onClose();
  };
  const submit = () => {
    void resolveEscalation(serverScope, escalation.id, 'resolved');
    onClose();
  };
  // LAND (epic-landing P3): re-derive readiness server-side then merge the epic onto
  // master. Distinct from Resolve, which would only DISMISS the card and silently
  // strand the work off-master (the destructive default we're replacing).
  const land = () => {
    void landEpic(serverScope, escalation.project, escalation.id);
    onClose();
  };

  // The ordered set of keyboard-answerable options across whichever branch.
  const answerables = useMemo<Answerable[]>(() => {
    if (spec) {
      return spec.elements
        .filter((e): e is Extract<typeof e, { type: 'OptionButton' }> => e.type === 'OptionButton')
        .map((e) => ({ optionId: e.optionId, label: e.label, recommended: !!e.recommended }));
    }
    if (escalation.options && escalation.options.length > 0) {
      return escalation.options.map((o) => ({ optionId: o.id, label: o.label, recommended: escalation.recommended === o.id }));
    }
    return [];
  }, [spec, escalation.options, escalation.recommended]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (/^[1-9]$/.test(ev.key)) {
        const opt = answerables[Number(ev.key) - 1];
        if (opt) {
          ev.preventDefault();
          decide(opt.optionId);
        }
        return;
      }
      if (ev.key === 'Enter') {
        const rec = answerables.find((a) => a.recommended);
        if (rec) {
          ev.preventDefault();
          decide(rec.optionId);
        }
        return;
      }
      if ((ev.key === 'j' || ev.key === 'J') && onJump) {
        ev.preventDefault();
        onJump(escalation.project, escalation.session);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerables, escalation.id]);

  return (
    <div
      data-testid="focal-decision-card"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80%] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Decision</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{escalation.session}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {(brief || briefLoading) && (
          <div data-testid="escalation-brief" className="space-y-1">
            {briefLoading && !brief ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Preparing briefing…</p>
            ) : (
              <>
                <div className="text-sm">
                  <Markdown content={brief as string} unstyled ariaLabel="Escalation briefing" />
                </div>
                <button
                  type="button"
                  onClick={() => void loadBrief(true)}
                  disabled={briefLoading}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
                >
                  {briefLoading ? 'Refreshing…' : '↻ Refresh briefing'}
                </button>
                <hr className="border-gray-200 dark:border-gray-700" />
              </>
            )}
          </div>
        )}

        {spec ? (
          <Renderer spec={spec} onDecide={decide} onSubmit={submit} />
        ) : escalation.options && escalation.options.length > 0 ? (
          <>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{escalation.questionText}</p>
            <div className="space-y-1.5">
              {escalation.options.map((opt, i) => {
                const recommended = escalation.recommended === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => decide(opt.id)}
                    className={`w-full flex items-start gap-2 text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                      recommended
                        ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-sm bg-gray-200 dark:bg-gray-700 text-xs font-mono">{i + 1}</span>
                    <span className="flex-1">
                      <span className="font-medium">{opt.label}</span>
                      {recommended && <span className="ml-1.5 text-xs font-semibold text-accent-600 dark:text-accent-400">★ recommended ↵</span>}
                      {opt.detail && <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{escalation.questionText}</p>
            <div className="flex items-center gap-2">
              {onJump && (
                <button
                  type="button"
                  onClick={() => onJump(escalation.project, escalation.session)}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Jump (J)
                </button>
              )}
              {isLand ? (
                <>
                  {/* Primary action for a land card is LAND (merge to master), not the
                      destructive Resolve. Resolve is demoted to a secondary Dismiss. */}
                  <button
                    type="button"
                    onClick={land}
                    title="Re-derive land-readiness server-side, then merge this epic onto master"
                    className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    🚀 Land
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    title="Dismiss this card without landing (the work stays on its epic branch)"
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  className="px-3 py-1.5 text-sm rounded bg-accent-600 text-white hover:bg-accent-700"
                >
                  Resolve
                </button>
              )}
            </div>
          </>
        )}

        {answerables.length > 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">
            <kbd className="font-mono">1–{Math.min(9, answerables.length)}</kbd> answer · <kbd className="font-mono">↵</kbd> ★recommended{onJump ? ' · ' : ''}{onJump && <><kbd className="font-mono">J</kbd> jump</>}
          </p>
        )}
      </div>
    </div>
  );
};

export default DecisionCard;
