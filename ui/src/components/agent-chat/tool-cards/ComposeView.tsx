import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';

interface ComposeViewProps {
  item: AgentToolCallItem;
}

type ComposeInput = {
  title?: string;
  body?: string;
  draft?: boolean;
};

type ComposeOutput = {
  branch?: string;
  commitSha?: string;
  prUrl?: string;
  pushed?: boolean;
  dirtyBefore?: boolean;
};

const ComposeView: React.FC<ComposeViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as ComposeInput;
  const title = input.title ?? '';
  const body = input.body;
  const draft = input.draft;

  const progressText = item.progress.map((p) => p.chunk).join('');

  const output =
    item.status !== 'running' && item.output && typeof item.output === 'object'
      ? (item.output as ComposeOutput)
      : undefined;

  const shortSha = output?.commitSha ? output.commitSha.slice(0, 7) : undefined;

  return (
    <div className="space-y-2">
      {title ? (
        <div className="font-mono text-[11px] bg-gray-900 text-green-300 p-2 rounded whitespace-pre-wrap break-all">
          {draft ? '[draft] ' : ''}
          {title}
        </div>
      ) : null}
      {body ? (
        <pre className="font-mono text-[11px] bg-gray-50 text-gray-700 p-2 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto">
          {body}
        </pre>
      ) : null}
      {progressText ? (
        <pre className="font-mono text-[11px] bg-gray-50 text-gray-800 p-2 rounded whitespace-pre-wrap break-all max-h-64 overflow-auto">
          {progressText}
        </pre>
      ) : null}
      {output ? (
        <div className="space-y-1 text-[11px]">
          {output.branch ? (
            <div>
              <span className="text-gray-500">branch </span>
              <code className="font-mono bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded">
                {output.branch}
              </code>
              {output.dirtyBefore ? (
                <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-yellow-100 text-yellow-800">
                  dirty
                </span>
              ) : null}
              {output.pushed ? (
                <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-800">
                  pushed
                </span>
              ) : null}
            </div>
          ) : null}
          {shortSha ? (
            <div>
              <span className="text-gray-500">commit </span>
              <code className="font-mono bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded">
                {shortSha}
              </code>
            </div>
          ) : null}
          {output.prUrl ? (
            <div>
              <span className="text-gray-500">pr </span>
              <a
                href={output.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline break-all"
              >
                {output.prUrl}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
      {item.error ? (
        <div className="text-xs text-red-600">{item.error}</div>
      ) : null}
    </div>
  );
};

export default ComposeView;
