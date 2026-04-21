import * as React from 'react';
import { useRef } from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../lib/utils';
import type { EffortLevel } from '../../../types/agent';

export interface ModelPillProps {
  model: string;
  className?: string;
  sessionId?: string;
  currentEffort?: EffortLevel;
  onOpenMenu?: (anchorRect: DOMRect) => void;
}

export const ModelPill: React.FC<ModelPillProps> = ({ model, className, onOpenMenu }) => {
  const ref = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (onOpenMenu && ref.current) onOpenMenu(ref.current.getBoundingClientRect());
  };

  return (
    <button
      type="button"
      ref={ref}
      onClick={handleClick}
      data-testid="model-pill"
      title={model}
      className={cn(
        'inline-flex items-center',
        onOpenMenu && 'cursor-pointer hover:bg-accent',
      )}
    >
      <Badge
        variant="outline"
        className={cn('text-[10px] font-mono', className)}
      >
        {model}
      </Badge>
    </button>
  );
};

ModelPill.displayName = 'ModelPill';
