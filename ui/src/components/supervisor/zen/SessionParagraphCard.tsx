import React, { useState } from 'react';
import type { SessionSummary, Escalation, ZenStructured } from '@/stores/supervisorStore';
import { fmtHHMM } from '@/lib/freshnessSelectors';
import { ageOpacityClass, summaryFreshness } from '@/lib/paragraphStack';
import { FreshnessPulse } from './FreshnessPulse';
import { PaneLinesPopover } from './PaneLinesPopover';

export interface SessionParagraphCardProps {
  summary: SessionSummary;
  now: number;
  serverId: string;
  /** Open escalation for THIS session, if any — drives structured→optionId path */
  escalation?: Escalation | null;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void;
  onResolve: (serverId: string, id: string, status: string) => void;
  onSnooze: (project: string, session: string) => void;
  onFetchPane: (project: string, session: string) => Promise<string>;
}

const STATUS_PILL: Record<ZenStructured['status'], { dot: string; text: string; label: string }> = {
  working:       { dot: 'bg-success-500', text: 'text-success-700 dark:text-success-400', label: 'working' },
  idle:          { dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400',       label: 'idle' },
  stuck:         { dot: 'bg-danger-500',  text: 'text-danger-700 dark:text-danger-400',   label: 'stuck' },
  'needs-input': { dot: 'bg-warning-500', text: 'text-warning-700 dark:text-warning-400', label: 'needs input' },
};

export const SessionParagraphCard: React.FC<SessionParagraphCardProps> = ({
  summary,
  now,
  serverId,
  escalation,
  onDecideEscalation,
  onAnswerPane,
  onResolve,
  onSnooze,
  onFetchPane,
}) => {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  const status: ZenStructured['status'] = summary.structured?.status ?? 'idle';
  const pill = STATUS_PILL[status];
  const fresh = summaryFreshness(summary, now);
  const opacityClass = ageOpacityClass(summary.summaryUpdatedAt, now);

  const sessionName = summary.session.split('/').pop() || summary.session;

  // Paragraph text derivation
  const paragraphText = summary.structured?.paragraph ?? summary.summaryText ?? '';
  const firstClauseText = summary.firstClause ?? (paragraphText.includes('. ')
    ? paragraphText.slice(0, paragraphText.indexOf('. ') + 1)
    : '');
  const remainder = firstClauseText
    ? paragraphText.slice(firstClauseText.length).trimStart()
    : paragraphText;

  // Two-timestamp title attr
  const summaryTs = summary.summaryUpdatedAt ? fmtHHMM(summary.summaryUpdatedAt) : '—';
  const paneTs = summary.paneSeenAt ? fmtHHMM(summary.paneSeenAt) : '—';
  const timestampTitle = `summary ${summaryTs} · pane ${paneTs}`;

  const structured = summary.structured;
  const needsInput = structured?.status === 'needs-input';

  const hasEscalationOptions = !!(escalation?.options && escalation.options.length > 0);
  const hasPaneOptions = !!(structured?.options && structured.options.length > 0);

  const handleOtherSend = () => {
    if (!otherText.trim()) return;
    onAnswerPane(serverId, summary.project, summary.session, otherText.trim());
    setOtherText('');
    setOtherOpen(false);
  };

  const handleApprove = () => {
    if (escalation && escalation.recommended) {
      onDecideEscalation(serverId, escalation.id, escalation.recommended);
    } else {
      onAnswerPane(serverId, summary.project, summary.session, 'yes');
    }
  };

  const handleSkip = () => {
    if (escalation) {
      onResolve(serverId, escalation.id, 'resolved');
    } else {
      onSnooze(summary.project, summary.session);
    }
  };

  return (
    <div
      data-testid="session-paragraph-card"
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2 transition-opacity duration-500 ${opacityClass}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0 text-sm">
          {sessionName}
        </span>
        {/* Dual indicator: structural status dot + freshness pulse */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pill.dot}`} />
        <FreshnessPulse live={!fresh.failing} />
        {/* Status pill label */}
        <span className={`text-3xs font-semibold shrink-0 ${pill.text}`}>
          {pill.label}
        </span>
      </div>

      {/* Paragraph (ALWAYS visible) */}
      {paragraphText ? (
        <div className="text-sm leading-snug whitespace-pre-wrap">
          {firstClauseText ? (
            <>
              <span className="font-medium text-gray-900 dark:text-gray-100">{firstClauseText}</span>
              {remainder && (
                <span className="text-gray-600 dark:text-gray-300"> {remainder}</span>
              )}
            </>
          ) : (
            <span className="text-gray-600 dark:text-gray-300">{paragraphText}</span>
          )}
        </div>
      ) : null}

      {/* Two timestamps */}
      <div
        className={`text-3xs ${fresh.failing ? 'text-warning-600 dark:text-warning-400' : 'text-gray-400 dark:text-gray-500'}`}
        title={timestampTitle}
      >
        {fresh.label}
      </div>

      {/* Pane lines popover */}
      <PaneLinesPopover
        project={summary.project}
        session={summary.session}
        onFetch={onFetchPane}
      />

      {/* Needs-input block */}
      {needsInput && (
        <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-700">
          {/* Raw question guardrail — ALWAYS shown above buttons */}
          <div className="text-sm text-gray-800 dark:text-gray-200">
            {structured?.question ?? 'Waiting for input'}
          </div>

          {/* Option buttons — branch by source */}
          {hasEscalationOptions ? (
            <div className="space-y-1.5">
              {escalation!.options!.map((opt) => {
                const recommended = escalation!.recommended === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onDecideEscalation(serverId, escalation!.id, opt.id)}
                    title={opt.detail ? `${opt.label} — ${opt.detail}` : opt.label}
                    className={`w-full flex items-start gap-1.5 px-3 py-1.5 rounded text-left text-sm transition-colors border ${
                      recommended
                        ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100 dark:hover:bg-accent-900/50'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="font-medium leading-tight">{opt.label}</span>
                      {recommended && (
                        <span className="ml-1 text-3xs font-semibold text-accent-600 dark:text-accent-400">
                          ★ recommended
                        </span>
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
          ) : hasPaneOptions ? (
            <div className="space-y-1.5">
              {structured!.options!.map((opt, i) => {
                const recommended = i === structured!.recommended;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onAnswerPane(serverId, summary.project, summary.session, opt.valueToSend)}
                    className={`w-full flex items-start gap-1.5 px-3 py-1.5 rounded text-left text-sm transition-colors border ${
                      recommended
                        ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100 dark:hover:bg-accent-900/50'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="font-medium leading-tight">{opt.label}</span>
                      {recommended && (
                        <span className="ml-1 text-3xs font-semibold text-accent-600 dark:text-accent-400">
                          ★ recommended
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* "Other…" guardrail — ALWAYS present, collapsed last-resort */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setOtherOpen((o) => !o)}
              className="text-3xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline decoration-dotted transition-colors"
            >
              {otherOpen ? 'Cancel' : 'Other…'}
            </button>
            {otherOpen && (
              <div className="space-y-1.5">
                <textarea
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder="Type a reply…"
                  rows={2}
                  className="w-full px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
                <button
                  type="button"
                  onClick={handleOtherSend}
                  disabled={!otherText.trim()}
                  className="px-3 py-1 text-sm font-medium rounded bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>

                {/* Global fallback cascade — Approve / Skip / Snooze */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleApprove}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => onSnooze(summary.project, summary.session)}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Snooze
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionParagraphCard;
