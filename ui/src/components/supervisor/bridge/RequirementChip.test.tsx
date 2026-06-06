import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementChip, parseTodoDragPayload, TODO_DRAG_MIME } from './RequirementChip';

describe('parseTodoDragPayload', () => {
  it('parses a valid object-linked todo payload', () => {
    expect(parseTodoDragPayload(JSON.stringify({ id: 't1', objectRef: 'obj-1' }))).toEqual({ id: 't1', objectRef: 'obj-1' });
  });
  it('normalizes a missing/non-string objectRef to null', () => {
    expect(parseTodoDragPayload(JSON.stringify({ id: 't1' }))).toEqual({ id: 't1', objectRef: null });
    expect(parseTodoDragPayload(JSON.stringify({ id: 't1', objectRef: 123 }))).toEqual({ id: 't1', objectRef: null });
  });
  it('returns null for empty / malformed / id-less payloads', () => {
    expect(parseTodoDragPayload('')).toBeNull();
    expect(parseTodoDragPayload(null)).toBeNull();
    expect(parseTodoDragPayload('{not json')).toBeNull();
    expect(parseTodoDragPayload(JSON.stringify({ objectRef: 'obj-1' }))).toBeNull(); // no id
  });
});

function dropEventInit(mime: string, value: string) {
  return {
    dataTransfer: {
      types: [mime],
      getData: (t: string) => (t === mime ? value : ''),
    },
  } as unknown as Parameters<typeof fireEvent.drop>[1];
}

describe('RequirementChip satisfy-drop', () => {
  it('an object-linked todo drop fires onSatisfyDrop(reqId, objectRef)', () => {
    const onSatisfyDrop = vi.fn();
    render(<RequirementChip spec={null} fallback="R" reqId="req-1" onSatisfyDrop={onSatisfyDrop} />);
    fireEvent.drop(screen.getByTestId('requirement-chip'), dropEventInit(TODO_DRAG_MIME, JSON.stringify({ id: 't1', objectRef: 'obj-9' })));
    expect(onSatisfyDrop).toHaveBeenCalledWith('req-1', 'obj-9');
  });

  it('a todo WITHOUT objectRef is rejected gracefully (onSatisfyReject, not onSatisfyDrop)', () => {
    const onSatisfyDrop = vi.fn();
    const onSatisfyReject = vi.fn();
    render(<RequirementChip spec={null} fallback="R" reqId="req-1" onSatisfyDrop={onSatisfyDrop} onSatisfyReject={onSatisfyReject} />);
    fireEvent.drop(screen.getByTestId('requirement-chip'), dropEventInit(TODO_DRAG_MIME, JSON.stringify({ id: 't1', objectRef: null })));
    expect(onSatisfyDrop).not.toHaveBeenCalled();
    expect(onSatisfyReject).toHaveBeenCalledWith('req-1');
  });

  it('a foreign drag (no todo payload) is ignored', () => {
    const onSatisfyDrop = vi.fn();
    render(<RequirementChip spec={null} fallback="R" reqId="req-1" onSatisfyDrop={onSatisfyDrop} />);
    fireEvent.drop(screen.getByTestId('requirement-chip'), dropEventInit('text/plain', 'hello'));
    expect(onSatisfyDrop).not.toHaveBeenCalled();
  });

  it('renders as a plain atom (no drop) when reqId/handler are absent', () => {
    render(<RequirementChip spec={{ metric: 'latency', op: '<', target: '100ms' } as any} />);
    expect(screen.getByTestId('requirement-chip').textContent).toContain('latency');
  });
});
