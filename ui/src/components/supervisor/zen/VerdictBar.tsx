import React, { useState, useEffect } from 'react';
import { type Escalation } from '@/stores/supervisorStore';
import { getWebSocketClient } from '@/lib/websocket';

export interface VerdictResult {
  tone: 'clear' | 'attention' | 'urgent' | 'offline';
  label: string;
  count: number;
}

export function computeVerdict(openEscalations: Escalation[], wsConnected: boolean): VerdictResult {
  if (!wsConnected) return { tone: 'offline', label: 'Reconnecting…', count: 0 };
  if (openEscalations.length === 0) return { tone: 'clear', label: 'All clear', count: 0 };
  const count = openEscalations.length;
  return { tone: 'urgent', label: `${count} decision${count === 1 ? '' : 's'} waiting`, count };
}

const TONE_CLASS: Record<VerdictResult['tone'], string> = {
  urgent: 'bg-danger-600 dark:bg-danger-700 text-white',
  attention: 'bg-warning-500 dark:bg-warning-600 text-white',
  clear: 'bg-success-600 dark:bg-success-700 text-white',
  offline: 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200',
};

export interface VerdictBarProps {
  openEscalations: Escalation[];
}

export const VerdictBar: React.FC<VerdictBarProps> = ({ openEscalations }) => {
  const [connected, setConnected] = useState(() => getWebSocketClient().isConnected());

  useEffect(() => {
    const ws = getWebSocketClient();
    const onConn = ws.onConnect(() => setConnected(true));
    const onDisc = ws.onDisconnect(() => setConnected(false));
    return () => {
      onConn.unsubscribe();
      onDisc.unsubscribe();
    };
  }, []);

  const verdict = computeVerdict(openEscalations, connected);

  return (
    <div
      data-testid="verdict-bar"
      className={`sticky top-0 z-10 w-full px-4 py-2 flex items-center justify-center text-sm font-semibold ${TONE_CLASS[verdict.tone]}`}
    >
      {verdict.label}
    </div>
  );
};

export default VerdictBar;
