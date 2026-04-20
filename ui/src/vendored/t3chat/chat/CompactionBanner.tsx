import * as React from 'react';
import { cn } from '../lib/utils';
import { Separator } from '../ui/separator';

export interface CompactionBannerProps {
  tokensBefore: number;
  tokensAfter: number;
  messagesRetained: number;
  ts?: number;
  className?: string;
}

export const CompactionBanner: React.FC<CompactionBannerProps> = ({
  tokensBefore,
  tokensAfter,
  messagesRetained,
  ts,
  className,
}) => {
  return (
    <div
      role="separator"
      aria-label="Context compacted"
      data-testid="compaction-banner"
      data-ts={ts}
      className={cn(
        'my-3 flex items-center gap-2 text-[11px] italic text-muted-foreground',
        className
      )}
    >
      <Separator className="flex-1" />
      <span className="whitespace-nowrap">
        Context compacted at {tokensBefore} tokens → {tokensAfter} · {messagesRetained} messages
        retained
      </span>
      <Separator className="flex-1" />
    </div>
  );
};

CompactionBanner.displayName = 'CompactionBanner';
