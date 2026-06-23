import React, { useState, useRef, useEffect } from 'react';
import { id8, startLeafDirective, type NextWork } from '@/lib/zenPulse';

// ZenNextPanel — the "What's next" full-card takeover (design doc zen-next-work-card-design,
// P1b). Shown when an idle (green) session card's Pulse invitation is tapped: the summary
// hides and the card body becomes a grounded list of next-work candidates — ready leaves to
// start, filed epics (→ their next-ready child), Inbox items to plan — plus the AI-proposed
// step (when present) and a free-text floor that's always reachable (the confabulation fence:
// the human always has the floor). Row actions reuse the same onSend → runAnswer path as
// answering a question, so feedback + refresh are identical.

interface ZenNextPanelProps {
  nextWork: NextWork;
  /** Phase 2 AI-proposed next step (null until the backend ships). */
  aiOption?: string | null;
  /** Shared answer-feedback from the card's runAnswer (pending → ✓ On it). */
  action: { kind: 'pending' | 'sent' | 'error'; label: string } | null;
  /** Send a directive into the session (label for the ✓ confirmation, text injected). */
  onSend: (label: string, text: string) => void;
  /** Open this session in the full collab UI — Inbox rows are planning-only, so they
   *  deep-link there rather than inject a build directive. */
  onPlan: () => void;
  /** Back to the summary view. */
  onClose: () => void;
}

export const ZenNextPanel: React.FC<ZenNextPanelProps> = ({ nextWork, aiOption, action, onSend, onPlan, onClose }) => {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the free-text floor so the full reply stays visible.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t, t);
    setDraft('');
  };

  const { ready, epics, inbox } = nextWork;
  const empty = ready.length === 0 && epics.length === 0 && inbox.length === 0 && !aiOption;
  const busy = action?.kind === 'pending';

  const rowBase =
    'w-full flex items-start gap-2 px-3 py-2 rounded-lg text-left text-sm border transition-colors disabled:opacity-50 disabled:cursor-wait';

  // Centerpiece confirmation — when a decision has been sent, fade everything
  // else away and show the chosen text as the focal point.
  if (action?.kind === 'sent') {
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-3 py-4 animate-fade-in">
        <div className="text-3xs font-semibold uppercase tracking-wider text-success-500 dark:text-success-400">✓ On it</div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 text-center leading-snug px-2">
          {action.label}
        </p>
        <p className="text-3xs text-gray-400 dark:text-gray-500 text-center">
          Waiting for summary refresh…
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
      {/* Header: title + back-to-summary toggle. */}
      <div className="shrink-0 flex items-center justify-between">
        <span className="text-3xs font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">What's next</span>
        <button
          type="button"
          onClick={onClose}
          title="Back to summary"
          className="text-3xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          summary
        </button>
      </div>

      {/* Candidate lists — scroll inside the card if they overflow. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
        {empty && (
          <div className="text-sm text-gray-400 dark:text-gray-500 italic py-2">Nothing queued — tell me what's next below.</div>
        )}

        {ready.length > 0 && (
          <>
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">Ready</div>
            {ready.map((leaf) => (
              <button
                key={leaf.id}
                type="button"
                disabled={busy}
                onClick={() => onSend(`Next: ${leaf.title}`, startLeafDirective(leaf))}
                title={`${leaf.title} · ${id8(leaf.id)}`}
                className={`${rowBase} border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 text-violet-900 dark:text-violet-100 hover:bg-violet-100 dark:hover:bg-violet-900/50`}
              >
                <span className="shrink-0 text-violet-400">▸</span>
                <span className="flex-1 min-w-0">{leaf.title}</span>
              </button>
            ))}
          </>
        )}

        {epics.length > 0 && (
          <>
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">Epics</div>
            {epics.map(({ epic, nextChild, readyCount }) => (
              <button
                key={epic.id}
                type="button"
                disabled={busy || !nextChild}
                onClick={() => nextChild && onSend(`Next: ${nextChild.title}`, startLeafDirective(nextChild))}
                title={nextChild ? `Start ${nextChild.title} · ${id8(nextChild.id)}` : 'No ready child'}
                className={`${rowBase} border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:hover:bg-white dark:disabled:hover:bg-gray-800`}
              >
                <span className="shrink-0 text-gray-400">▣</span>
                <span className="flex-1 min-w-0">
                  {epic.title.replace(/^\s*\[EPIC\]\s*/i, '')}
                  {nextChild ? (
                    <span className="block text-3xs text-gray-400 dark:text-gray-500 truncate">→ {nextChild.title}</span>
                  ) : (
                    <span className="block text-3xs text-gray-400 dark:text-gray-500">{readyCount === 0 ? 'no ready child' : `${readyCount} ready`}</span>
                  )}
                </span>
              </button>
            ))}
          </>
        )}

        {inbox.length > 0 && (
          <>
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">Inbox — plan</div>
            {inbox.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={onPlan}
                title="Open to plan / re-home (Inbox is planning-only)"
                className={`${rowBase} border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40`}
              >
                <span className="shrink-0 text-amber-500">✎</span>
                <span className="flex-1 min-w-0">{item.title}</span>
              </button>
            ))}
          </>
        )}

        {aiOption && (
          <>
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-1">Suggested</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSend(aiOption, aiOption)}
              className={`${rowBase} border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`}
            >
              <span className="shrink-0 text-gray-400">⟂</span>
              <span className="flex-1 min-w-0">{aiOption}</span>
            </button>
          </>
        )}
      </div>

      {/* Free-text floor — always reachable; the human always has the floor. */}
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="…or tell me what's next"
        rows={1}
        disabled={busy}
        className="shrink-0 w-full px-2.5 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700/60 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-violet-300 dark:focus:ring-violet-700 resize-none overflow-hidden leading-relaxed"
      />
    </div>
  );
};

export default ZenNextPanel;
