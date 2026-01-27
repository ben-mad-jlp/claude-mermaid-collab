import React from 'react';
import { MessageArea } from '../MessageArea';
import { EmbeddedTerminal } from '../EmbeddedTerminal';
import type { TerminalConfig } from '../../types/terminal';

export interface WorkspacePanelProps {
  messageContent: React.ReactNode;
  terminalConfig?: TerminalConfig;
}

export function WorkspacePanel({
  messageContent,
  terminalConfig = { wsUrl: '/terminal' },
}: WorkspacePanelProps) {
  return (
    <div
      data-testid="workspace-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        gap: '0',
      }}
    >
      <div
        style={{
          flex: '1',
          overflow: 'auto',
          padding: '16px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
        }}
      >
        <MessageArea content={messageContent} />
      </div>

      <div
        style={{
          flex: '2',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <EmbeddedTerminal config={terminalConfig} />
      </div>
    </div>
  );
}
