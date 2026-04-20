import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface GrepViewProps {
  item: AgentToolCallItem;
}

interface GrepInput {
  pattern?: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: string;
  '-i'?: boolean;
  '-n'?: boolean;
  multiline?: boolean;
}

const Chip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground text-xs px-1.5 py-0.5">
    <span className="font-semibold">{label}:</span>
    <span className="font-mono">{value}</span>
  </span>
);

export const GrepView: React.FC<GrepViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as GrepInput;
  const { pattern, path, glob, type, output_mode, multiline } = input;
  const caseInsensitive = input['-i'];
  const showLineNumbers = input['-n'];

  let summary: string | null = null;
  let topHits: string[] = [];
  if (typeof item.output === 'string' && item.output.length > 0) {
    const lines = item.output.split('\n').filter((l) => l.length > 0);
    const files = new Set<string>();
    for (const line of lines) {
      const idx = line.indexOf(':');
      const prefix = idx >= 0 ? line.slice(0, idx) : line;
      files.add(prefix);
    }
    summary = `${lines.length} matches / ${files.size} files`;
    topHits = lines.slice(0, 5);
  }

  const stdout = typeof item.output === 'string' ? item.output : undefined;

  return (
    <div className="space-y-2 text-sm" data-testid="grep-view">
      {pattern !== undefined && (
        <div>
          <code className="font-mono bg-muted px-1 rounded">{pattern}</code>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {path && <Chip label="path" value={path} />}
        {glob && <Chip label="glob" value={glob} />}
        {type && <Chip label="type" value={type} />}
        {output_mode && <Chip label="mode" value={output_mode} />}
        {caseInsensitive && <Chip label="-i" value="true" />}
        {showLineNumbers && <Chip label="-n" value="true" />}
        {multiline && <Chip label="multiline" value="true" />}
      </div>
      {summary && (
        <div className="text-xs text-muted-foreground font-medium" data-testid="grep-summary">
          {summary}
        </div>
      )}
      {topHits.length > 0 && (
        <ul className="text-[11px] font-mono space-y-0.5">
          {topHits.map((h, i) => (
            <li key={i} className="truncate text-muted-foreground" title={h}>
              {h}
            </li>
          ))}
        </ul>
      )}
      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        stdout={stdout}
        output={typeof item.output === 'string' ? undefined : item.output}
        error={item.error}
        format="text"
      />
    </div>
  );
};

export default GrepView;
