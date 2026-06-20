import React from 'react';
import { type Escalation, type EscalationOption } from '@/stores/supervisorStore';
import { createOptimisticController } from '@/lib/optimisticAction';
import { type PendingClear, withinUndoWindow, undoMsRemaining } from '@/lib/triageSelectors';

export interface FocusCardProps {
  escalation: Escalation;
  serverScope: string;
  onDecide: (serverId: string, id: string, optionId: string) => void;
  onResolve: (serverId: string, id: string, status: string) => void;
  onLand: (serverId: string, project: string, id: string) => void;
  // Z9: operator-gated "only you" mark
  isOnlyYou?: boolean;
  onToggleOnlyYou?: (serverId: string, id: string) => void;
  // Z9: optimistic clear + undo affordance
  pending?: PendingClear | null;
  now?: number;
  onUndo?: (serverId: string, id: string) => void;
}

export const FocusCard: React.FC<FocusCardProps> = ({
  escalation: e,
  serverScope,
  onDecide,
  onResolve,
  onLand,
  isOnlyYou,
  onToggleOnlyYou,
  pending,
  now,
  onUndo,
}) => {
  const hasOptions = !!e.options && e.options.length > 0;
  const operatorGated = !!e.operatorGated;

  const showPending = !!pending && (now == null || withinUndoWindow(pending, now));

  const [, force] = React.useReducer((n: number) => n + 1, 0);
  const ctrlRef = React.useRef<ReturnType<typeof createOptimisticController> | undefined>(undefined);
  if (!ctrlRef.current) {
    ctrlRef.current = createOptimisticController({ onChange: () => force() });
  }
  React.useEffect(() => () => ctrlRef.current?.dispose(), []);

  const [sent, setSent] = React.useState<{ id: string; optId: string; label: string } | null>(null);

  const handlePick = (opt: EscalationOption) => {
    const id = ctrlRef.current!.stage({
      key: e.id,
      label: opt.label,
      apply: () => setSent({ id: '', optId: opt.id, label: opt.label }),
      revert: () => setSent(null),
      commit: async () => { onDecide(serverScope, e.id, opt.id); return true; },
    });
    setSent((s) => (s ? { ...s, id } : { id, optId: opt.id, label: opt.label }));
  };

  return (
    <div
      data-testid="focus-card"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3"
    >
      <div className="flex items-center text-3xs font-semibold tracking-wide text-warning-600 dark:text-warning-400 uppercase">
        ⚠ Decision required
        {operatorGated && (
          <span
            data-testid="operator-gated-badge"
            className="ml-2 inline-flex items-center gap-0.5 text-3xs font-semibold uppercase tracking-wide text-danger-600 dark:text-danger-400"
          >
            🔒 Only you
          </span>
        )}
        {onToggleOnlyYou && (
          <button
            type="button"
            data-testid="only-you-toggle"
            aria-pressed={!!isOnlyYou}
            title="Pin to top tier (only you can clear)"
            onClick={() => onToggleOnlyYou(serverScope, e.id)}
            className={`ml-2 text-3xs font-semibold normal-case tracking-normal ${
              isOnlyYou
                ? 'text-accent-600 dark:text-accent-400'
                : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {isOnlyYou ? '★ Only you' : '☆ Only you'}
          </button>
        )}
      </div>
      <div className="text-sm leading-snug text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
        {e.questionText}
      </div>
      {showPending ? (
        <div
          data-testid="pending-clear-toast"
          className="space-y-1 pt-1"
        >
          <span className="block text-3xs text-gray-500 dark:text-gray-400">
            sent → {pending!.label}
          </span>
          <button
            type="button"
            data-testid="pending-undo"
            onClick={() => onUndo?.(serverScope, e.id)}
            className="text-xs font-semibold underline hover:no-underline"
          >
            {now != null
              ? `Undo (${Math.ceil(undoMsRemaining(pending!, now) / 1000)}s)`
              : 'Undo'}
          </button>
        </div>
      ) : sent ? (
        <div
          data-testid="decide-sent-toast"
          className="flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-accent-50 dark:bg-accent-900/30 text-sm text-accent-800 dark:text-accent-200"
        >
          <span>sent → <span className="font-medium">{sent.label}</span></span>
          <button
            type="button"
            data-testid="decide-undo"
            onClick={() => { ctrlRef.current!.undo(sent.id); }}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Undo
          </button>
        </div>
      ) : hasOptions ? (
        <div className="space-y-1.5 pt-1">
          {e.options!.map((opt) => {
            const recommended = e.recommended === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handlePick(opt)}
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
          >
            🚀 Land
          </button>
          <button
            type="button"
            onClick={() => onResolve(serverScope, e.id, 'resolved')}
            className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
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
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
};

export default FocusCard;
