import React from 'react';
import { type Escalation } from '@/stores/supervisorStore';
import { selectVerdict, type Freshness, type VerdictTone } from '@/lib/freshnessSelectors';
import { FreshnessPulse } from './FreshnessPulse';

const TONE_CLASS: Record<VerdictTone, string> = {
  urgent: 'bg-danger-600 dark:bg-danger-700 text-white',
  attention: 'bg-warning-500 dark:bg-warning-600 text-white',
  clear: 'bg-success-600 dark:bg-success-700 text-white',
  disconnected: 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200',
};

export interface VerdictBarProps {
  openEscalations: Escalation[];
  freshness: Freshness;
  now: number;
}

export const VerdictBar: React.FC<VerdictBarProps> = ({ openEscalations, freshness, now }) => {
  const verdict = selectVerdict(openEscalations, freshness, now);
  return (
    <div
      data-testid="verdict-bar"
      data-tone={verdict.tone}
      className={`sticky top-0 z-10 w-full px-4 py-2 flex items-center justify-center gap-2 text-sm font-semibold ${TONE_CLASS[verdict.tone]}`}
    >
      <FreshnessPulse live={freshness.live} />
      <span>{verdict.line}</span>
    </div>
  );
};

export default VerdictBar;
