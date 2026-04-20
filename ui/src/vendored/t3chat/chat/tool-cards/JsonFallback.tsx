import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';

export interface JsonFallbackProps {
  item: AgentToolCallItem;
}

const PRE_CLASS =
  'font-mono text-[11px] bg-muted text-foreground p-2 rounded overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all';

export const JsonFallback: React.FC<JsonFallbackProps> = ({ item }) => {
  const hasOutput = item.output !== undefined && item.output !== null;
  const outputText =
    typeof item.output === 'string'
      ? item.output
      : hasOutput
        ? JSON.stringify(item.output, null, 2)
        : '';

  return (
    <div className="space-y-2" data-testid="json-fallback">
      <pre className={PRE_CLASS}>{JSON.stringify(item.input ?? {}, null, 2)}</pre>
      {hasOutput && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Output
          </div>
          <pre className={PRE_CLASS}>{outputText}</pre>
        </div>
      )}
      {item.error && <div className="text-[11px] text-destructive font-mono">{item.error}</div>}
    </div>
  );
};

export default JsonFallback;
