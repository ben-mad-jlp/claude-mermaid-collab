import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface BashViewProps {
  item: AgentToolCallItem;
}

interface BashInput {
  command?: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

export const BashView: React.FC<BashViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as BashInput;
  const command = input.command ?? '';
  const description = input.description;

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  for (const p of item.progress) {
    if (p.channel === 'stdout') stdoutChunks.push(p.chunk);
    else if (p.channel === 'stderr') stderrChunks.push(p.chunk);
  }

  const isDone = item.status !== 'running';
  const finalStdout = isDone && typeof item.output === 'string' ? item.output : null;
  const stdoutText = finalStdout ?? stdoutChunks.join('');
  const stderrText = stderrChunks.join('');

  return (
    <div className="space-y-2" data-testid="bash-view">
      <pre className="font-mono text-[11px] bg-muted text-foreground p-2 rounded whitespace-pre-wrap break-all">
        <span className="text-emerald-600 dark:text-emerald-400">$ </span>
        {command}
      </pre>
      {description ? (
        <div className="text-xs italic text-muted-foreground">{description}</div>
      ) : null}
      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        stdout={stdoutText}
        stderr={stderrText}
        error={item.error}
        format="ansi"
      />
    </div>
  );
};

export default BashView;
