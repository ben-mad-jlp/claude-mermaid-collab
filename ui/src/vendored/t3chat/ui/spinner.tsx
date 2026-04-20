import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

export function Spinner({ className, size = 16, ...props }: SpinnerProps) {
  return <Loader2 aria-hidden className={cn('animate-spin text-muted-foreground', className)} width={size} height={size} {...props} />;
}
