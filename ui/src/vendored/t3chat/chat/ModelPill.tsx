import * as React from 'react';
import { Badge } from '../ui/badge';
import { cn } from '../lib/utils';

export interface ModelPillProps {
  model: string;
  className?: string;
}

export const ModelPill: React.FC<ModelPillProps> = ({ model, className }) => {
  return (
    <Badge
      variant="outline"
      data-testid="model-pill"
      className={cn('text-[10px] font-mono', className)}
      title={model}
    >
      {model}
    </Badge>
  );
};

ModelPill.displayName = 'ModelPill';
