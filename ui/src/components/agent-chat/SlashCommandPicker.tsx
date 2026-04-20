import { useEffect, useMemo, useState } from 'react';

export type Command = {
  name: string;
  description?: string;
};

export type SlashCommandPickerProps = {
  query: string;
  commands?: Command[];
  onSelect: (cmd: Command) => void;
  onDismiss: () => void;
};

const DEFAULT_COMMANDS: Command[] = [
  { name: '/help', description: 'Show help' },
  { name: '/clear', description: 'Clear the conversation' },
  { name: '/compact', description: 'Compact the conversation' },
  { name: '/model', description: 'Change the model' },
  { name: '/resume', description: 'Resume a previous session' },
  { name: '/cost', description: 'Show token usage / cost' },
];

/**
 * Score a command by case-insensitive substring match.
 * Returns a positive score for matches (higher = better), or 0 for no match.
 * Empty query matches everything with a baseline score.
 */
function scoreCommand(cmd: Command, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const name = cmd.name.toLowerCase();
  // Exact match scores highest
  if (name === q) return 1000;
  // Prefix match (including the leading slash and the leading slash stripped)
  if (name.startsWith(q)) return 500 - (name.length - q.length);
  // Prefix after slash, e.g. query "he" matches "/help"
  if (q.length > 0 && !q.startsWith('/') && name.slice(1).startsWith(q)) {
    return 400 - (name.length - 1 - q.length);
  }
  // Substring match
  const idx = name.indexOf(q);
  if (idx !== -1) return 100 - idx;
  // Fall back to description match
  if (cmd.description && cmd.description.toLowerCase().includes(q)) return 10;
  return 0;
}

function filterAndSort(commands: Command[], query: string): Command[] {
  const scored = commands
    .map((cmd) => ({ cmd, score: scoreCommand(cmd, query) }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.cmd);
}

export function SlashCommandPicker({
  query,
  commands,
  onSelect,
  onDismiss,
}: SlashCommandPickerProps) {
  const source = commands ?? DEFAULT_COMMANDS;
  const filtered = useMemo(() => filterAndSort(source, query), [source, query]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Clamp selection when the filtered list changes.
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filtered.length === 0) return 0;
      if (prev >= filtered.length) return filtered.length - 1;
      if (prev < 0) return 0;
      return prev;
    });
  }, [filtered.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          if (filtered.length === 0) return 0;
          return (prev + 1) % filtered.length;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          if (filtered.length === 0) return 0;
          return (prev - 1 + filtered.length) % filtered.length;
        });
      } else if (e.key === 'Enter') {
        if (filtered.length === 0) return;
        const cmd = filtered[selectedIndex];
        if (cmd) {
          e.preventDefault();
          onSelect(cmd);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selectedIndex, onSelect, onDismiss]);

  if (filtered.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      data-testid="slash-command-picker"
      className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden max-h-64 overflow-y-auto"
    >
      {filtered.map((cmd, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-testid={`slash-command-option-${cmd.name.replace(/^\//, '')}`}
            className={
              'w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors ' +
              (isSelected
                ? 'bg-blue-100 dark:bg-blue-900/40'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800')
            }
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => onSelect(cmd)}
          >
            <span className="font-mono text-sm">{cmd.name}</span>
            {cmd.description && (
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {cmd.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SlashCommandPicker;
