import React from 'react';
import { id8, startLeafDirective, type PulseStage, type NextUp } from '@/lib/zenPulse';

// The Pulse footer line (design doc design-zen-spark-work). Absorbs the plain
// "updated Ns ago" span: the card renders this ONLY for the pulsing stages
// (settled/warm/glowing) on an idle/green card; paused/off render the plain label.
// Attention brightens by stage — never the header, never red, never a pop.

interface ZenPulseLineProps {
  /** 'settled' | 'warm' | 'glowing' (the card gates pulsing stages). */
  stage: PulseStage;
  /** Next-ready leaf / blocked / empty for this session's project. */
  nextUp: NextUp;
  /** Phase 2: an AI-proposed single next step (null in v1). */
  aiOption?: string | null;
  /** Shared answer-feedback from the card's runAnswer (pending → ✓ On it). */
  action: { kind: 'pending' | 'sent' | 'error'; label: string } | null;
  /** Send a nudge (label for the ✓ confirmation, text injected into the session). */
  onSend: (label: string, text: string) => void;
  /** Open the full-card "What's next" panel (the invitation tap fills the card). */
  onExpand: () => void;
  /** Sleep the lane for this idle episode. */
  onDismiss: () => void;
}

export const ZenPulseLine: React.FC<ZenPulseLineProps> = ({ stage, nextUp, aiOption, action, onSend, onExpand, onDismiss }) => {
  const glowing = stage === 'glowing';
  const armed = stage === 'warm' || stage === 'glowing';

  // After a tap, show the same calm confirmation the question UI uses.
  if (action && action.kind !== 'error') {
    return (
      <div className="shrink-0 mt-1 text-3xs font-medium text-success-600 dark:text-success-400">
        {action.kind === 'pending' ? <span className="animate-pulse">…on it</span> : <>✓ On it — “{action.label}”</>}
      </div>
    );
  }

  // A one-line hero preview of the next-ready leaf (warm+ only) — a glanceable hint of
  // what tapping will offer; the full list (ready/epics/inbox + free text) lives in the
  // What's-Next panel that `onExpand` opens to fill the card.
  let chip: React.ReactNode = null;
  if (armed) {
    if (nextUp.mode === 'ready' && nextUp.leaf) {
      const leaf = nextUp.leaf;
      chip = (
        <button
          type="button"
          onClick={() => onSend(`Next: ${leaf.title}`, startLeafDirective(leaf))}
          title={`${leaf.title} · ${id8(leaf.id)}`}
          className={`px-2.5 py-1 rounded-full text-3xs font-semibold border border-violet-300 dark:border-violet-700 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 hover:bg-violet-200 dark:hover:bg-violet-800/50 transition-colors truncate max-w-[14rem] ${glowing ? 'animate-pulse' : ''}`}
        >
          ▸ Next: {leaf.title}
        </button>
      );
    } else if (nextUp.mode === 'blocked') {
      chip = (
        <span className="text-3xs text-gray-400 dark:text-gray-500 truncate">
          🔒 Next is blocked{nextUp.blockedBy ? ` — waiting on “${nextUp.blockedBy}”` : ''}
        </span>
      );
    } else if (aiOption) {
      chip = (
        <button
          type="button"
          onClick={() => onSend(aiOption, aiOption)}
          className={`px-2.5 py-1 rounded-full text-3xs font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors truncate max-w-[14rem] ${glowing ? 'animate-pulse' : ''}`}
        >
          ⟂ {aiOption}
        </button>
      );
    }
  }

  return (
    <div className="shrink-0 mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={onExpand}
        title="What's next — fill the card with next-work options"
        className="text-3xs font-medium text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
      >
        {stage === 'settled' ? 'ready for the next thing?' : 'ready for more →'}
      </button>
      {chip}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onDismiss}
        title="Not now"
        className="text-3xs leading-none text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
      >
        ×
      </button>
    </div>
  );
};

export default ZenPulseLine;
