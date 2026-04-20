import React, { useEffect, useState } from 'react';
import type { AgentPermissionItem } from '@/stores/agentStore';
import type { PermissionDecision } from '@/types/agent';
import { detectDanger } from '@/lib/dangerous-commands';

interface Props {
  item: AgentPermissionItem;
  onResolve: (promptId: string, decision: PermissionDecision) => void;
}

const StatusBadge: React.FC<{ status: AgentPermissionItem['status'] }> = ({ status }) => {
  const colorMap: Record<string, string> = {
    pending: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
    allowed: 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100',
    denied: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100',
    timeout: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100',
  };
  const cls = colorMap[status] ?? colorMap.timeout;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${cls}`}>
      {status}
    </span>
  );
};

const PermissionCard: React.FC<Props> = ({ item, onResolve }) => {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, item.deadlineMs - Date.now())
  );

  useEffect(() => {
    if (item.status !== 'pending') return;
    const id = setInterval(() => {
      setRemainingMs(Math.max(0, item.deadlineMs - Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [item.deadlineMs, item.status]);

  const bashCommand =
    item.name === 'Bash' && item.input && typeof (item.input as { command?: unknown }).command === 'string'
      ? ((item.input as { command: string }).command)
      : '';
  const danger = bashCommand ? detectDanger(bashCommand) : { dangerous: false };
  const denyReason =
    (item as unknown as { reason?: string; denyReason?: string; resolvedReason?: string }).reason ??
    (item as unknown as { denyReason?: string }).denyReason ??
    (item as unknown as { resolvedReason?: string }).resolvedReason;

  return (
    <div className="max-w-[85%] rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">{item.name}</span>
          <StatusBadge status={item.status} />
        </div>
        {item.status === 'pending' && (
          <span className="text-amber-700 dark:text-amber-300">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        )}
      </div>
      <div className="p-3 space-y-2">
        <pre className="text-[11px] whitespace-pre-wrap break-words max-h-48 overflow-auto bg-gray-900 text-gray-100 p-2 rounded">
          {JSON.stringify(item.input, null, 2)}
        </pre>
        {item.status === 'denied' && (
          <div className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-2 py-1.5 text-[11px]">
            <div className="font-semibold">Tool blocked</div>
            {denyReason && <div className="opacity-80">{denyReason}</div>}
          </div>
        )}
        {item.status === 'pending' && danger.dangerous && (
          <div className="rounded border border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 px-2 py-1.5 text-[11px]">
            <div className="font-semibold">⚠ Dangerous command</div>
            {danger.reason && <div className="opacity-80">{danger.reason}</div>}
          </div>
        )}
        {item.status === 'pending' && (
          <div className="flex gap-2">
            <button
              onClick={() => onResolve(item.id, 'allow_once')}
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Allow Once
            </button>
            <button
              onClick={() => onResolve(item.id, 'allow_session')}
              className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700"
            >
              Allow Session
            </button>
            <button
              onClick={() => onResolve(item.id, 'deny')}
              className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
            >
              Deny
            </button>
          </div>
        )}
        {item.status !== 'pending' && item.resolvedBy && (
          <div className="text-[11px] text-gray-500">resolved by {item.resolvedBy}</div>
        )}
      </div>
    </div>
  );
};

PermissionCard.displayName = 'PermissionCard';

export default PermissionCard;
