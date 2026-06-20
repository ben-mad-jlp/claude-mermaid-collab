import React from 'react';
import { type Escalation } from '@/stores/supervisorStore';

export interface FocusCardProps {
  escalation: Escalation;
  serverScope: string;
  onDecide: (serverId: string, id: string, optionId: string) => void;
  onResolve: (serverId: string, id: string, status: string) => void;
  onLand: (serverId: string, project: string, id: string) => void;
}

export const FocusCard: React.FC<FocusCardProps> = ({
  escalation: e,
  serverScope,
  onDecide,
  onResolve,
  onLand,
}) => {
  const hasOptions = !!e.options && e.options.length > 0;
  return (
    <div
      data-testid="focus-card"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3"
    >
      <div className="text-3xs font-semibold tracking-wide text-warning-600 dark:text-warning-400 uppercase">
        ⚠ Decision required
      </div>
      <div className="text-sm leading-snug text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
        {e.questionText}
      </div>
      {hasOptions ? (
        <div className="space-y-1.5 pt-1">
          {e.options!.map((opt) => {
            const recommended = e.recommended === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDecide(serverScope, e.id, opt.id)}
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
      ) : e.kind === 'epic-ready-to-land' ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onLand(serverScope, e.project, e.id)}
            className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            title="Merge this epic onto master"
          >
            🚀 Land
          </button>
          <button
            type="button"
            onClick={() => onResolve(serverScope, e.id, 'resolved')}
            className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
            title="Dismiss without landing"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onResolve(serverScope, e.id, 'resolved')}
            className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
            title="Mark resolved"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
};

export default FocusCard;
