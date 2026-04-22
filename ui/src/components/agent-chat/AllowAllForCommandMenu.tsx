import { memo, useCallback } from 'react';
import { getWebSocketClient } from '../../lib/websocket';

export interface AllowAllForCommandMenuProps {
  sessionId: string;
  toolName: string;
  input?: unknown;
  disabled?: boolean;
  className?: string;
}

function derivePathGlob(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const inp = input as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const fp = (inp.file_path ?? inp.path) as string | undefined;
      if (!fp) return undefined;
      const dir = fp.split('/').slice(0, -1).join('/');
      return dir ? `${dir}/**` : undefined;
    }
    case 'Grep':
    case 'Glob': {
      const p = (inp.path ?? inp.directory) as string | undefined;
      if (!p) return undefined;
      return p.endsWith('/**') ? p : `${p}/**`;
    }
    case 'WebFetch':
    case 'WebSearch': {
      const u = inp.url as string | undefined;
      if (!u) return undefined;
      try {
        const parsed = new URL(u);
        return `${parsed.origin}/**`;
      } catch {
        return undefined;
      }
    }
    default:
      return undefined;
  }
}

export const AllowAllForCommandMenu = memo(function AllowAllForCommandMenu({
  sessionId,
  toolName,
  input,
  disabled,
  className,
}: AllowAllForCommandMenuProps) {
  const handleClick = useCallback(() => {
    const pathGlob = derivePathGlob(toolName, input);
    const commandId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cmd-${Date.now()}`;
    const cmd: Record<string, unknown> = {
      type: 'agent_command',
      command: {
        kind: 'agent_add_allowlist_rule',
        sessionId,
        toolName,
        commandId,
      },
    };
    if (pathGlob) (cmd.command as Record<string, unknown>).pathGlob = pathGlob;
    getWebSocketClient().send(cmd as Parameters<ReturnType<typeof getWebSocketClient>['send']>[0]);
  }, [sessionId, toolName, input]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={`Allow all uses of ${toolName} with wildcard rule`}
      title={`Allow all ${toolName}`}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className ?? ''}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M7 1L2 4v4c0 2.5 2.2 4.8 5 5.5 2.8-.7 5-3 5-5.5V4L7 1z" />
        <path d="M5 7l1.5 1.5L9.5 5" />
      </svg>
      Allow all {toolName}
    </button>
  );
});

export default AllowAllForCommandMenu;
