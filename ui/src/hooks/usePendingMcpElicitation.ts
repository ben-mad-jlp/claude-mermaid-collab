import { useCallback, useEffect, useState } from 'react';
import { getWebSocketClient } from '../lib/websocket';

export interface McpElicitationField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  label?: string;
  options?: string[];
  required?: boolean;
}

export interface McpElicitationRequest {
  elicitationId: string;
  sessionId: string;
  prompt: string;
  fields: McpElicitationField[];
  server: string;
}

export function usePendingMcpElicitation(sessionId: string | null): {
  pending: McpElicitationRequest | null;
  dismiss: () => void;
} {
  const [pending, setPending] = useState<McpElicitationRequest | null>(null);

  useEffect(() => {
    setPending(null);
    if (!sessionId) return;
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: unknown) => {
      const m = msg as { type?: string; sessionId?: string } | null;
      if (m?.type === 'mcp_elicitation_requested' && m.sessionId === sessionId) {
        setPending(m as unknown as McpElicitationRequest);
      }
    });
    return () => {
      sub.unsubscribe();
    };
  }, [sessionId]);

  const dismiss = useCallback(() => setPending(null), []);

  return { pending, dismiss };
}
