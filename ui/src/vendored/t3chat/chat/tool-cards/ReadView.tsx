import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { OutputPanel } from './OutputPanel';

export interface ReadViewProps {
  item: AgentToolCallItem;
}

export const ReadView: React.FC<ReadViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as {
    file_path?: string;
    offset?: number;
    limit?: number;
  };

  const rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [];
  if (input.file_path !== undefined) {
    rows.push({ label: 'file_path', value: input.file_path, mono: true });
  }
  if (input.offset !== undefined) rows.push({ label: 'offset', value: String(input.offset) });
  if (input.limit !== undefined) rows.push({ label: 'limit', value: String(input.limit) });

  const outputFormat = typeof item.output === 'string' ? 'lines' : 'text';

  return (
    <div data-testid="read-view">
      {rows.length > 0 ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map((row) => (
            <React.Fragment key={row.label}>
              <div className="text-muted-foreground">{row.label}</div>
              <div
                className={
                  row.mono ? 'font-mono break-all text-foreground' : 'text-foreground'
                }
              >
                {row.value}
              </div>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <div className="mt-2">
        <OutputPanel
          toolUseId={item.id}
          status={item.status}
          output={item.output}
          error={item.error}
          format={outputFormat}
        />
      </div>
    </div>
  );
};

export default ReadView;
