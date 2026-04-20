import * as React from 'react';
import { cn } from '../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

export interface ThinkingBlockProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  text,
  streaming = false,
  className,
}) => {
  const [open, setOpen] = React.useState(false);

  if (streaming) {
    return (
      <div
        data-testid="thinking-block"
        className={cn(
          'max-w-[85%] rounded-lg border border-border bg-muted/30 text-xs',
          className
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse"
            data-testid="thinking-pulse"
            aria-hidden="true"
          />
          <span className="font-medium text-foreground/80">Thinking…</span>
        </div>
        {text ? (
          <div className="px-3 pb-2 text-[11px] italic text-muted-foreground whitespace-pre-wrap break-words">
            {text}
          </div>
        ) : null}
      </div>
    );
  }

  const charCount = text.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-testid="thinking-block"
      className={cn(
        'max-w-[85%] rounded-lg border border-border bg-muted/30 text-xs',
        className
      )}
    >
      <CollapsibleTrigger
        data-testid="thinking-toggle"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted rounded-lg"
        aria-expanded={open}
      >
        <span className="text-muted-foreground" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-medium text-foreground/80">
          Thinking ({charCount} chars)
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent
        data-testid="thinking-content"
        className="px-3 pb-3 text-[11px] italic text-muted-foreground whitespace-pre-wrap break-words"
      >
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
};

ThinkingBlock.displayName = 'ThinkingBlock';
