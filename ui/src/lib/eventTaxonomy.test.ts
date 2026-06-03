import { describe, it, expect } from 'vitest';
import {
  EVENT_TAXONOMY,
  fromAuditEntry,
  fromWsMessage,
  matchesCategory,
  type StreamEvent,
} from './eventTaxonomy';
import type { AuditEntry } from '@/stores/supervisorStore';

describe('eventTaxonomy', () => {
  it('maps an escalation_created ws message to escalation.opened (danger / needs-me)', () => {
    const e = fromWsMessage({
      type: 'escalation_created',
      id: 'esc1',
      project: '/a/b',
      session: 'worker-1',
      kind: 'decision',
      questionText: 'A or B?',
      ts: 1000,
    });
    expect(e).not.toBeNull();
    expect(e!.type).toBe('escalation.opened');
    expect(e!.severity).toBe('danger');
    expect(e!.category).toBe('needs-me');
    expect(e!.escalationId).toBe('esc1');
    expect(e!.id).toBe('esc-esc1');
  });

  it('folds artifact churn into the muted artifact.updated bucket', () => {
    const e = fromWsMessage({ type: 'document_updated', id: 'd1', name: 'spec', ts: 5 });
    expect(e!.type).toBe('artifact.updated');
    expect(e!.severity).toBe('muted');
  });

  it('only surfaces context.high above the threshold', () => {
    expect(fromWsMessage({ type: 'claude_context_update', contextPercent: 50 })).toBeNull();
    const hot = fromWsMessage({ type: 'claude_context_update', contextPercent: 91, session: 's', ts: 2 });
    expect(hot!.type).toBe('context.high');
  });

  it('returns null for unrecognized messages', () => {
    expect(fromWsMessage({ type: 'pair_mode_changed' })).toBeNull();
    expect(fromWsMessage(null)).toBeNull();
    expect(fromWsMessage({})).toBeNull();
  });

  it('backfills audit kinds onto their taxonomy keys', () => {
    const entry: AuditEntry = {
      id: 'a1',
      ts: 42,
      kind: 'claim',
      project: '/a/b',
      session: 'worker-9',
      detail: JSON.stringify({ todoId: 't1', title: 'Do thing' }),
      serverId: 'local',
    };
    const e = fromAuditEntry(entry);
    expect(e.type).toBe('todo.claimed');
    expect(e.id).toBe('audit-a1');
    expect(e.todoId).toBe('t1');
    expect(e.detail).toBe('Do thing');
  });

  it('matchesCategory treats null as All', () => {
    const e = { category: 'blocks' } as StreamEvent;
    expect(matchesCategory(e, null)).toBe(true);
    expect(matchesCategory(e, 'blocks')).toBe(true);
    expect(matchesCategory(e, 'needs-me')).toBe(false);
  });

  it('every taxonomy entry has an icon + token class', () => {
    for (const meta of Object.values(EVENT_TAXONOMY)) {
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(meta.tokenClass).toMatch(/text-/);
    }
  });
});
