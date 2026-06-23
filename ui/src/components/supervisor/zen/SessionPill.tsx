import React from 'react';
import { type SubscribedSession } from '@/stores/subscriptionStore';
import { type ProgressState } from '@/stores/supervisorStore';

export interface SessionPillProps {
  session: SubscribedSession;
  /** Per-session structural-heartbeat readout (Z2). When progressState is
   *  stalled/wedged it overrides the subscription-status dot/label/text. */
  progressState?: ProgressState;
}

const STATUS_DOT: Record<SubscribedSession['status'], string> = {
  active: 'bg-success-500 dark:bg-success-400',
  waiting: 'bg-gray-400 dark:bg-gray-500',
  permission: 'bg-warning-500 dark:bg-warning-400',
  unknown: 'bg-gray-300 dark:bg-gray-600',
};

const STATUS_LABEL: Record<SubscribedSession['status'], string> = {
  active: 'active',
  waiting: 'waiting',
  permission: 'needs input',
  unknown: 'unknown',
};

const STATUS_TEXT: Record<SubscribedSession['status'], string> = {
  active: 'text-success-700 dark:text-success-400',
  waiting: 'text-gray-500 dark:text-gray-400',
  permission: 'text-warning-700 dark:text-warning-400',
  unknown: 'text-gray-400 dark:text-gray-500',
};

const PROGRESS_DOT: Partial<Record<ProgressState, string>> = {
  stalled: 'bg-warning-500 dark:bg-warning-400',
  wedged:  'bg-danger-500 dark:bg-danger-400',
};

const PROGRESS_LABEL: Partial<Record<ProgressState, string>> = {
  stalled: 'stalled',
  wedged:  'wedged',
};

const PROGRESS_TEXT: Partial<Record<ProgressState, string>> = {
  stalled: 'text-warning-700 dark:text-warning-400',
  wedged:  'text-danger-700 dark:text-danger-400',
};

export const SessionPill: React.FC<SessionPillProps> = ({ session, progressState }) => {
  const name = session.session.split('/').pop() || session.session;
  const dim = session.stale;
  const dotClass  = (progressState && PROGRESS_DOT[progressState])  ?? STATUS_DOT[session.status];
  const textClass = (progressState && PROGRESS_TEXT[progressState]) ?? STATUS_TEXT[session.status];
  const label     = (progressState && PROGRESS_LABEL[progressState]) ?? STATUS_LABEL[session.status];
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs ${dim ? 'opacity-50' : ''}`}
      title={`${session.project} / ${session.session}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
      />
      <span className="font-medium text-gray-700 dark:text-gray-300 max-w-[120px] truncate">
        {name}
      </span>
      <span className={`text-3xs font-medium ${textClass}`}>
        {label}
      </span>
    </div>
  );
};

export default SessionPill;
