import * as React from 'react';
import { cn } from '../lib/utils';
import { groupByTurn, type TimelineItem } from './MessagesTimeline.logic';
import { CompactionBanner } from './CompactionBanner';
import { ThinkingBlock } from './ThinkingBlock';
import { ModelPill } from './ModelPill';
import type { CompactionEntry } from '@/stores/agentStore';

export interface MessagesTimelineProps {
  items: readonly TimelineItem[];
  renderItem: (item: TimelineItem) => React.ReactNode;
  renderTurnSeparator?: (turnId: string, isFirst: boolean) => React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
  checkpointsByTurn?: Record<string, { firstSeq: number; stashSha: string }>;
  onRevertToCheckpoint?: (turnId: string) => void;
  currentTurnId?: string | null;
  compactions?: readonly CompactionEntry[];
  thinkingByTurn?: Record<string, string>;
  modelByTurn?: Record<string, string>;
}

interface ConfirmState {
  turnId: string;
  subsequentCount: number;
}

export const MessagesTimeline: React.FC<MessagesTimelineProps> = ({
  items,
  renderItem,
  renderTurnSeparator,
  emptyState,
  className,
  checkpointsByTurn,
  onRevertToCheckpoint,
  currentTurnId,
  compactions,
  thinkingByTurn,
  modelByTurn,
}) => {
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null);
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (confirm && !dlg.open) {
      try {
        dlg.showModal();
      } catch {
        // no-op
      }
    } else if (!confirm && dlg.open) {
      dlg.close();
    }
  }, [confirm]);

  const groups = React.useMemo(() => groupByTurn(items), [items]);

  // Index compactions by the id of the timeline item they should render after.
  // Use a Map<string, CompactionEntry[]> so multiple compactions after the same
  // anchor render in the order they arrived.
  const compactionsByAfterId = React.useMemo(() => {
    const map = new Map<string, CompactionEntry[]>();
    const leading: CompactionEntry[] = [];
    for (const c of compactions ?? []) {
      if (c.afterTimelineId == null) {
        leading.push(c);
      } else {
        const list = map.get(c.afterTimelineId) ?? [];
        list.push(c);
        map.set(c.afterTimelineId, list);
      }
    }
    return { map, leading };
  }, [compactions]);

  // Find the first assistant message id for each turn, so we can render a
  // ThinkingBlock just above it.
  const firstAssistantIdByTurn = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of groups) {
      for (const it of g.items) {
        if (it.kind === 'message' && it.role === 'assistant') {
          if (!(g.turnId in out)) out[g.turnId] = it.id;
        }
      }
    }
    return out;
  }, [groups]);

  if (items.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm text-muted-foreground', className)}>
        {emptyState ?? 'No messages yet'}
      </div>
    );
  }

  const onConfirm = () => {
    if (confirm && onRevertToCheckpoint) {
      onRevertToCheckpoint(confirm.turnId);
    }
    setConfirm(null);
  };

  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', className)}>
      {compactionsByAfterId.leading.map((c, i) => (
        <CompactionBanner
          key={`compaction-leading-${i}`}
          tokensBefore={c.tokensBefore}
          tokensAfter={c.tokensAfter}
          messagesRetained={c.messagesRetained}
          ts={c.ts}
        />
      ))}
      {groups.map((group, gi) => {
        const hasCheckpoint = !!(checkpointsByTurn && checkpointsByTurn[group.turnId]);
        const isInFlight = currentTurnId === group.turnId;
        const showRevert = hasCheckpoint && !isInFlight && !!onRevertToCheckpoint;
        const subsequentCount = groups.length - gi - 1;
        const model = modelByTurn?.[group.turnId];
        const thinking = thinkingByTurn?.[group.turnId];
        const firstAssistantId = firstAssistantIdByTurn[group.turnId];
        const showSeparatorRow =
          !!renderTurnSeparator || showRevert || !!model;
        return (
          <React.Fragment key={group.turnId}>
            {showSeparatorRow ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2">
                  {renderTurnSeparator ? renderTurnSeparator(group.turnId, gi === 0) : null}
                  {model ? <ModelPill model={model} /> : null}
                </div>
                {showRevert ? (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({ turnId: group.turnId, subsequentCount })
                    }
                    className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
                    aria-label="Revert to before this turn"
                  >
                    Revert
                  </button>
                ) : null}
              </div>
            ) : null}
            {group.items.map((it) => {
              const renderThinkingHere =
                thinking != null &&
                firstAssistantId === it.id;
              const followingCompactions = compactionsByAfterId.map.get(it.id);
              return (
                <React.Fragment key={it.id}>
                  {renderThinkingHere ? (
                    <ThinkingBlock
                      text={thinking}
                      streaming={currentTurnId === group.turnId}
                    />
                  ) : null}
                  {renderItem(it)}
                  {followingCompactions
                    ? followingCompactions.map((c, i) => (
                        <CompactionBanner
                          key={`compaction-${it.id}-${i}`}
                          tokensBefore={c.tokensBefore}
                          tokensAfter={c.tokensAfter}
                          messagesRetained={c.messagesRetained}
                          ts={c.ts}
                        />
                      ))
                    : null}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="revert-confirm-title"
        className="rounded-md border border-border bg-background p-4 text-foreground shadow-lg backdrop:bg-black/40"
        onClose={() => setConfirm(null)}
        onCancel={(e) => {
          e.preventDefault();
          setConfirm(null);
        }}
      >
        {confirm ? (
          <div className="flex flex-col gap-3 min-w-[280px] max-w-[400px]">
            <h2 id="revert-confirm-title" className="text-sm font-semibold">
              Revert to before this turn?
            </h2>
            <p className="text-sm text-muted-foreground">
              {confirm.subsequentCount > 0
                ? `This discards ${confirm.subsequentCount} subsequent turn${confirm.subsequentCount === 1 ? '' : 's'}.`
                : 'This discards the current turn.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="text-xs px-3 py-1 rounded border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="text-xs px-3 py-1 rounded border border-destructive bg-destructive text-destructive-foreground hover:opacity-90"
                autoFocus
              >
                Revert
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
};

MessagesTimeline.displayName = 'MessagesTimeline';
