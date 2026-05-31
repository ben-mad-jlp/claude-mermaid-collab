import React, { useState, useEffect, useMemo } from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';

export interface EscalationInboxProps {
  serverId: string;
  onJump?: (project: string, session: string) => void;
}

const KIND_GLYPH: Record<string, string> = {
  question: '❓',
  decision: '🔀',
  blocker: '⛔',
  approval: '✅',
};

const KIND_OPTIONS = ['all', 'question', 'decision', 'blocker', 'approval'];

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const EscalationInbox: React.FC<EscalationInboxProps> = ({ serverId, onJump }) => {
  const escalations = useSupervisorStore((s) => s.escalations);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);

  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open');
  const [kindFilter, setKindFilter] = useState<string>('all');

  useEffect(() => {
    const status = statusFilter === 'open' ? 'open' : 'resolved';
    void loadEscalations(serverId, status);
  }, [serverId, statusFilter, loadEscalations]);

  const visible = useMemo(() => {
    return escalations.filter((e: Escalation) => {
      const statusMatch =
        statusFilter === 'open' ? e.status === 'open' : e.status !== 'open';
      const kindMatch = kindFilter === 'all' || e.kind === kindFilter;
      return statusMatch && kindMatch;
    });
  }, [escalations, statusFilter, kindFilter]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Escalations
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-xs font-normal">
          {visible.length}
        </span>

        {/* Kind filter */}
        <select
          value={kindFilter}
          onChange={(ev) => setKindFilter(ev.target.value)}
          className="ml-auto text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1 py-0.5 outline-none"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k === 'all' ? 'All kinds' : k}
            </option>
          ))}
        </select>

        {/* Open / Resolved toggle */}
        <div className="flex rounded overflow-hidden border border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setStatusFilter('open')}
            className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
              statusFilter === 'open'
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setStatusFilter('resolved')}
            className={`px-2 py-0.5 text-[11px] font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
              statusFilter === 'resolved'
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
          {statusFilter === 'open'
            ? '✓ No open escalations — all clear.'
            : 'No resolved escalations.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((e: Escalation) => (
            <div
              key={e.id}
              className="px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 space-y-1"
            >
              {/* Kind label + source */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]" title={e.kind}>
                  {KIND_GLYPH[e.kind] ?? '⚠'}
                </span>
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate">
                  {`${e.project.split('/').pop()} / ${e.session}`}
                </span>
                <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
                  {relativeTime(e.createdAt)}
                </span>
              </div>

              {/* Question text */}
              <div className="text-xs font-mono leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                {e.questionText}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  onClick={() => onJump?.(e.project, e.session)}
                  className="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-200 text-gray-700 border border-gray-300 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 transition-colors"
                  title="Jump to session"
                >
                  Jump to session
                </button>
                {e.status === 'open' && (
                  <button
                    onClick={() => void resolveEscalation(serverId, e.id, 'resolved')}
                    className="px-2 py-0.5 text-[11px] rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    title="Mark resolved and remove from inbox"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
