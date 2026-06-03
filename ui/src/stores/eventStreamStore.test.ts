import { describe, it, expect, beforeEach } from 'vitest';
import { useEventStreamStore } from './eventStreamStore';
import type { StreamEvent } from '@/lib/eventTaxonomy';
import type { AuditEntry } from '@/stores/supervisorStore';

function ev(id: string, ts: number): StreamEvent {
  return {
    id,
    ts,
    type: 'artifact.updated',
    severity: 'muted',
    icon: '·',
    tokenClass: 'text-gray-500',
    category: 'activity',
    project: '/p',
    session: 's',
    title: id,
  };
}

describe('eventStreamStore', () => {
  beforeEach(() => useEventStreamStore.getState().clear());

  it('appends events sorted by ts ascending', () => {
    const { push } = useEventStreamStore.getState();
    push(ev('b', 20));
    push(ev('a', 10));
    expect(useEventStreamStore.getState().events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('dedupes by id (live + audit echo collapse to one)', () => {
    const { push } = useEventStreamStore.getState();
    push(ev('x', 1));
    push(ev('x', 1));
    expect(useEventStreamStore.getState().events).toHaveLength(1);
  });

  it('ignores unrecognized ws messages via pushFromWs', () => {
    useEventStreamStore.getState().pushFromWs({ type: 'pair_mode_changed' });
    expect(useEventStreamStore.getState().events).toHaveLength(0);
  });

  it('backfills audit entries without clobbering existing events', () => {
    const { push, backfillFromAudit } = useEventStreamStore.getState();
    push(ev('live', 100));
    const audit: AuditEntry[] = [
      { id: 'h1', ts: 5, kind: 'spawn', project: '/p', session: 's', detail: null, serverId: 'local' },
    ];
    backfillFromAudit(audit);
    const ids = useEventStreamStore.getState().events.map((e) => e.id);
    expect(ids).toContain('live');
    expect(ids).toContain('audit-h1');
    // history sorts before the live event
    expect(ids.indexOf('audit-h1')).toBeLessThan(ids.indexOf('live'));
  });

  it('caps the buffer at capacity, dropping oldest first', () => {
    const { push } = useEventStreamStore.getState();
    for (let i = 0; i < 520; i++) push(ev(`e${i}`, i));
    const events = useEventStreamStore.getState().events;
    expect(events).toHaveLength(500);
    expect(events[0].id).toBe('e20'); // first 20 dropped
    expect(events[events.length - 1].id).toBe('e519');
  });
});
