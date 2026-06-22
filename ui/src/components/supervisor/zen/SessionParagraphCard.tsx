import React, { useState } from 'react';
import type { SessionSummary, Escalation, ZenStructured } from '@/stores/supervisorStore';
import { fmtHHMM } from '@/lib/freshnessSelectors';
import { ageOpacityClass, summaryFreshness } from '@/lib/paragraphStack';
import { FreshnessPulse } from './FreshnessPulse';
import { PaneLinesPopover } from './PaneLinesPopover';
import { useNotificationStore } from '@/stores/notificationStore';

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
  working:       { dot: 'bg-amber-400 dark:bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',   label: 'working' },
  idle:          { dot: 'bg-emerald-400 dark:bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'done' },
  stuck:         { dot: 'bg-rose-400 dark:bg-rose-500',     text: 'text-rose-600 dark:text-rose-400',     label: 'stuck' },
  'needs-input': { dot: 'bg-rose-400 dark:bg-rose-500',     text: 'text-rose-600 dark:text-rose-400',     label: 'needs input' },
};

const THRESH_MIN = 50;
const THRESH_MAX = 95;

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
  const [refreshing, setRefreshing] = useState(false);
  const [threshOpen, setThreshOpen] = useState(false);
  const [threshVal, setThreshVal] = useState(75);

  // Stable item id — matches triageItemId session: style
  const itemId = escalation?.id ?? `session:${summary.project}::${summary.session}`;

  // Store subscriptions
  const snoozedEntry        = useNotificationStore((s) => s.snoozed[itemId]);
  const operatorOnly        = useNotificationStore((s) => !!s.operatorOnly[itemId]);
  const pendingClear        = useNotificationStore((s) => s.pendingClears[itemId]);
  const refreshSummaryNow   = useNotificationStore((s) => s.refreshSummaryNow);
  const snoozeItem          = useNotificationStore((s) => s.snoozeItem);
  const unsnoozeItem        = useNotificationStore((s) => s.unsnoozeItem);
  const markOperatorOnly    = useNotificationStore((s) => s.markOperatorOnly);
  const clearItemOptimistic = useNotificationStore((s) => s.clearItemOptimistic);
  const undoClear           = useNotificationStore((s) => s.undoClear);
  const setWatchdogThreshold = useNotificationStore((s) => s.setWatchdogThreshold);

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

  // Snooze check using the `now` prop (single clock source — no Date.now() here)
  const isSnoozed = !!snoozedEntry && snoozedEntry.expiresAt > now;

  // Early return: snoozed
  if (isSnoozed) {
    return (
      <div
        data-testid="session-paragraph-card"
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-2 opacity-40"
      >
        <span className="text-sm text-gray-500 dark:text-gray-400 flex-1 min-w-0 truncate">
          {sessionName}
        </span>
        <button
          type="button"
          onClick={() => unsnoozeItem(itemId)}
          className="text-3xs text-accent-600 dark:text-accent-400 underline decoration-dotted shrink-0"
        >
          Un-snooze
        </button>
      </div>
    );
  }

  // Early return: optimistic clear pending
  if (pendingClear) {
    return (
      <div
        data-testid="session-paragraph-card"
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-2"
      >
        <span className="text-sm text-gray-500 dark:text-gray-400 flex-1 min-w-0 truncate">
          sent → {pendingClear.label}
        </span>
        <button
          type="button"
          onClick={() => undoClear(itemId)}
          className="text-3xs text-accent-600 dark:text-accent-400 underline decoration-dotted shrink-0 font-medium"
        >
          Undo
        </button>
      </div>
    );
  }

  const handleOtherSend = () => {
    const text = otherText.trim();
    if (!text) return;
    clearItemOptimistic(itemId, text, async () => {
      onAnswerPane(serverId, summary.project, summary.session, text);
      return true;
    });
    setOtherText('');
    setOtherOpen(false);
  };

  const handleApprove = () => {
    if (escalation && escalation.recommended) {
      clearItemOptimistic(itemId, 'approved', async () => {
        onDecideEscalation(serverId, escalation.id, escalation.recommended!);
        return true;
      });
    } else {
      clearItemOptimistic(itemId, 'approved', async () => {
        onAnswerPane(serverId, summary.project, summary.session, 'yes');
        return true;
      });
    }
  };

  const handleSkip = () => {
    if (escalation) {
      clearItemOptimistic(itemId, 'skipped', async () => {
        onResolve(serverId, escalation.id, 'resolved');
        return true;
      });
    } else {
      snoozeItem(itemId, 10 * 60_000);
      onSnooze(summary.project, summary.session);
    }
  };

  const handleSnoozeBottom = () => {
    snoozeItem(itemId, 10 * 60_000);
    onSnooze(summary.project, summary.session);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void refreshSummaryNow(serverId, summary.project, summary.session).finally(() =>
      setRefreshing(false)
    );
  };

  const handleThresholdApply = () => {
    const pct = Math.min(THRESH_MAX, Math.max(THRESH_MIN, Math.round(threshVal)));
    void setWatchdogThreshold(serverId, summary.project, pct).then((ok) => {
      if (ok) setThreshOpen(false);
    });
  };

  return (
    <div
      data-testid="session-paragraph-card"
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2 transition-opacity duration-500 ${opacityClass}${operatorOnly ? ' border-l-2 border-l-accent-500' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0 text-sm">
          <span className="text-gray-400 dark:text-gray-500 font-normal">{summary.project} /</span>{' '}
          {sessionName}
        </span>
        {/* Dual indicator: structural status dot + freshness pulse */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pill.dot}`} />
        <FreshnessPulse live={!fresh.failing} />
        {/* Status pill label */}
        <span className={`text-3xs font-semibold shrink-0 ${pill.text}`}>
          {pill.label}
        </span>
        {/* Only-you toggle */}
        <button
          type="button"
          aria-pressed={operatorOnly}
          onClick={() => markOperatorOnly(itemId, !operatorOnly)}
          title="Pin to top — only you can clear"
          className="shrink-0 text-sm leading-none text-gray-400 dark:text-gray-500 aria-pressed:text-accent-500 transition-colors"
        >
          {operatorOnly ? '★' : '☆'}
        </button>
        {/* Refresh */}
        <button
          type="button"
          disabled={refreshing}
          onClick={handleRefresh}
          title="Re-summarize now (force-proof)"
          className={`shrink-0 text-sm leading-none text-gray-400 dark:text-gray-500 disabled:opacity-40 transition-colors ${refreshing ? 'animate-pulse' : ''}`}
        >
          ⟳
        </button>
      </div>

      {/* Paragraph (ALWAYS visible) */}
      {paragraphText ? (
        <div className="text-sm leading-snug space-y-1">
          {firstClauseText ? (
            <>
              <div className="font-medium text-gray-900 dark:text-gray-100">{firstClauseText}</div>
              {remainder && remainder.split(/(?<=\.)\s+/).map((s, i) => (
                <div key={i} className="text-gray-600 dark:text-gray-300">{s}</div>
              ))}
            </>
          ) : (
            paragraphText.split(/(?<=\.)\s+/).map((s, i) => (
              <div key={i} className={i === 0 ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}>{s}</div>
            ))
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

      {/* Threshold control */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setThreshOpen((o) => !o)}
          className="text-3xs text-gray-400 dark:text-gray-500 underline decoration-dotted transition-colors"
        >
          ⚙ threshold
        </button>
        {threshOpen && (
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              min={THRESH_MIN}
              max={THRESH_MAX}
              value={threshVal}
              onChange={(e) => setThreshVal(Number(e.target.value))}
              className="w-16 px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
            <span className="text-3xs text-gray-400 dark:text-gray-500">%</span>
            <button
              type="button"
              onClick={handleThresholdApply}
              className="px-2 py-1 text-3xs font-medium rounded bg-accent-600 text-white transition-colors"
            >
              Apply
            </button>
          </div>
        )}
      </div>

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
                    onClick={() => clearItemOptimistic(itemId, opt.label, async () => {
                      onDecideEscalation(serverId, escalation!.id, opt.id);
                      return true;
                    })}
                    title={opt.detail ? `${opt.label} — ${opt.detail}` : opt.label}
                    className={`w-full flex items-start gap-1.5 px-3 py-1.5 rounded text-left text-sm transition-colors border ${
                      recommended
                        ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'
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
                    onClick={() => clearItemOptimistic(itemId, opt.label, async () => {
                      onAnswerPane(serverId, summary.project, summary.session, opt.valueToSend);
                      return true;
                    })}
                    className={`w-full flex items-start gap-1.5 px-3 py-1.5 rounded text-left text-sm transition-colors border ${
                      recommended
                        ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'
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
              className="text-3xs text-gray-500 dark:text-gray-400 underline decoration-dotted transition-colors"
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
                  className="px-3 py-1 text-sm font-medium rounded bg-accent-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>

                {/* Global fallback cascade — Approve / Skip / Snooze */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleApprove}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={handleSnoozeBottom}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 transition-colors"
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
