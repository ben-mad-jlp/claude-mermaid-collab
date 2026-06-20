import React, { useEffect, useState } from 'react';
import { useFreshnessStore } from '@/stores/freshnessStore';

export interface FreshnessPulseProps {
  /** Whether the read-model feed is live. A dead feed shows a static, muted dot. */
  live: boolean;
}

/**
 * FreshnessPulse — a breathing dot. Beats (briefly scales/glows) on each successful
 * read-model refresh (every change to `lastWsMessageAt`), so a live feed visibly
 * "breathes". When `!live` (dead-man's switch tripped) the dot goes solid muted gray
 * and never pulses. Mirrors the Header daemon-tick pulse pattern.
 */
export const FreshnessPulse: React.FC<FreshnessPulseProps> = ({ live }) => {
  const lastWsMessageAt = useFreshnessStore((s) => s.lastWsMessageAt);
  const [beating, setBeating] = useState(false);

  useEffect(() => {
    if (!lastWsMessageAt || !live) return;
    setBeating(true);
    const id = setTimeout(() => setBeating(false), 600);
    return () => clearTimeout(id);
  }, [lastWsMessageAt, live]);

  return (
    <span
      data-testid="freshness-pulse"
      title={live ? 'Feed live' : 'Feed not updating'}
      className={`inline-block w-2 h-2 rounded-full transition-all duration-150 ${
        live ? 'bg-success-500' : 'bg-gray-400'
      } ${
        live && beating
          ? 'animate-pulse scale-[1.9] ring-2 ring-success-400/70 shadow-[0_0_6px_2px] shadow-success-400/60'
          : ''
      }`}
    />
  );
};

export default FreshnessPulse;
