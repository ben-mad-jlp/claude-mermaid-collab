import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import OutputPanel from './OutputPanel';

interface BashViewProps {
  item: AgentToolCallItem;
}

type BashInput = {
  command?: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
};

const BashView: React.FC<BashViewProps> = ({ item }) => {
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
  const finalStdout =
    isDone && typeof item.output === 'string' ? item.output : null;
  const stdoutText = finalStdout ?? stdoutChunks.join('');
  const stderrText = stderrChunks.join('');

  return (
    <div className="space-y-2">
      <pre className="font-mono text-[11px] bg-gray-900 text-green-300 p-2 rounded whitespace-pre-wrap break-all">
        $ {command}
      </pre>
      {description ? (
        <div className="text-xs italic text-gray-500">{description}</div>
      ) : null}
      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        stdout={stdoutText}
        stderr={stderrText}
        error={item.error}
        format="ansi"
      />
      {item.error && item.status !== 'error' ? (
        <div className="text-xs text-red-600">{item.error}</div>
      ) : null}
    </div>
  );
};

export default BashView;
