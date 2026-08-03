import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusPill, STATUS_LABEL } from '../missionShared';

describe('missionShared closed label', () => {
  it('STATUS_LABEL.closed reads Converged with a check glyph', () => {
    expect(STATUS_LABEL.closed).toMatch(/Converged/);
    expect(STATUS_LABEL.closed).toContain('✓');
  });

  it('no STATUS_LABEL entry is the bare token Closed or closed', () => {
    expect(Object.values(STATUS_LABEL)).not.toContain('Closed');
    expect(Object.values(STATUS_LABEL)).not.toContain('closed');
  });

  it('StatusPill status=closed renders Converged text, not closed', () => {
    render(<StatusPill status="closed" />);
    const pill = screen.getByTestId('mission-status-pill');
    expect(pill.textContent).toMatch(/Converged/);
    expect(pill.textContent).not.toMatch(/closed/i);
  });
});
