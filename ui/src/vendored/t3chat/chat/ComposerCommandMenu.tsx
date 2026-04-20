import * as React from 'react';
import { cn } from '../lib/utils';
import { highlightMatch } from './composerMenuHighlight';
import type { SlashSearchResult } from './composerSlashCommandSearch';

export interface ComposerCommandMenuProps {
  open: boolean;
  query: string;
  results: SlashSearchResult[];
  activeIndex: number;
  onHover: (i: number) => void;
  onSelect: (i: number) => void;
  className?: string;
}

export const ComposerCommandMenu: React.FC<ComposerCommandMenuProps> = ({
  open,
  query,
  results,
  activeIndex,
  onHover,
  onSelect,
  className,
}) => {
  if (!open || results.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className={cn(
        'absolute bottom-full mb-1 left-0 right-0 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md z-50',
        className
      )}
    >
      {results.map((r, i) => {
        const segments = highlightMatch(r.command.name, query);
        const active = i === activeIndex;
        return (
          <button
            type="button"
            key={r.command.id}
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(i)}
            className={cn(
              'w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm',
              active && 'bg-accent text-accent-foreground'
            )}
          >
            <span className="font-mono">
              /
              {segments.map((seg, j) => (
                <span key={j} className={seg.match ? 'font-bold text-primary' : undefined}>
                  {seg.text}
                </span>
              ))}
            </span>
            {r.command.description ? (
              <span className="text-xs text-muted-foreground">{r.command.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

ComposerCommandMenu.displayName = 'ComposerCommandMenu';
