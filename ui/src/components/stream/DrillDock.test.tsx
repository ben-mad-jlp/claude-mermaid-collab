/**
 * DrillDock test — verifies the escalation case renders BridgeEscalationInbox
 * with options[] support (the old EscalationInbox had no options rendering).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrillDock } from './DrillDock';
import type { Escalation } from '@/stores/supervisorStore';

function esc(p: Partial<Escalation>): Escalation {
  return {
    id: p.id ?? 'e1',
    project: 'P',
    session: 'worker-1',
    kind: 'decision',
    questionText: 'pick one',
    status: 'open',
    createdAt: 1,
    ...p,
  } as Escalation;
}

describe('DrillDock', () => {
  it('renders BridgeEscalationInbox with options[] from an escalation', () => {
    const escalations = [
      esc({
        id: 'e1',
        project: 'P',
        status: 'open',
        questionText: 'Choose an action',
        options: [
          { id: 'a', label: 'Ship it' },
          { id: 'b', label: 'Hold' },
        ],
      }),
    ];
    render(
      <DrillDock
        target={{ kind: 'escalation' }}
        serverScope="local"
        project="P"
        subscriptions={[]}
        todos={[]}
        escalations={escalations}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('bridge-escalation-inbox')).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    expect(screen.getByText('Hold')).toBeInTheDocument();
  });
});
