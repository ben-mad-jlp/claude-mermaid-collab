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

  it('narrates a drive.auto_resolved decision with verb/bucket/confidence/reason', () => {
    const e = fromWsMessage({
      type: 'drive.auto_resolved',
      project: '/a/b',
      todoId: 't1',
      escalationId: 'esc9',
      verb: 'override_accept_todo',
      bucket: 'verified-done',
      confidence: 0.92,
      reason: 'artifact exists and matches spec',
      ts: 100,
    });
    expect(e!.type).toBe('drive.auto_resolved');
    expect(e!.severity).toBe('success');
    expect(e!.category).toBe('activity');
    expect(e!.title).toBe('Drive accepted — verified-done (0.92)');
    expect(e!.detail).toBe('artifact exists and matches spec');
    expect(e!.todoId).toBe('t1');
    expect(e!.escalationId).toBe('esc9');
    expect(e!.id).toBe('drive-res-esc9');
  });

  it('narrates a drive.auto_landed success and a conflict distinctly', () => {
    const landed = fromWsMessage({
      type: 'drive.auto_landed',
      project: '/a/b',
      escalationId: 'esc10',
      epicId: 'e1',
      epicBranch: 'collab/epic/abcd1234',
      landed: true,
      conflict: false,
      masterSha: 'deadbeefcafe',
      reason: 'all children accepted',
      ts: 101,
    });
    expect(landed!.type).toBe('drive.auto_landed');
    expect(landed!.severity).toBe('success');
    expect(landed!.title).toBe('Drive landed collab/epic/abcd1234 → master deadbeef');
    expect(landed!.id).toBe('drive-land-esc10');

    const conflict = fromWsMessage({
      type: 'drive.auto_landed',
      project: '/a/b',
      escalationId: 'esc11',
      epicBranch: 'collab/epic/abcd1234',
      landed: false,
      conflict: true,
      reason: 'epic-merge-conflict',
      ts: 102,
    });
    expect(conflict!.title).toBe('Drive land conflict — collab/epic/abcd1234 left for human rebase');
    expect(conflict!.detail).toBe('epic-merge-conflict');
  });

  it('narrates a supervisor_nudge into nudge.sent with target + text', () => {
    const e = fromWsMessage({
      type: 'supervisor_nudge',
      project: '/a/b',
      session: 'worker-3',
      text: 'you have ready todos',
      sent: true,
      ts: 103,
    });
    expect(e!.type).toBe('nudge.sent');
    expect(e!.severity).toBe('info');
    expect(e!.session).toBe('worker-3');
    expect(e!.title).toBe('Nudged worker-3');
    expect(e!.detail).toBe('you have ready todos');
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
    // Human title folds in the parsed title; raw JSON is never surfaced.
    expect(e.title).toContain('Do thing');
    expect(e.detail).toBeUndefined();
  });

  it('never surfaces a raw JSON blob as detail or title', () => {
    const entry: AuditEntry = {
      id: 'a2',
      ts: 1,
      kind: 'escalate',
      project: '/a/b',
      session: 'backend-1',
      detail: JSON.stringify({ kind: 'decision', escalationId: 'x9' }),
      serverId: 'local',
    };
    const e = fromAuditEntry(entry);
    expect(e.title).not.toContain('{');
    expect(e.title).toContain('backend-1');
    expect(e.detail ?? '').not.toContain('{');
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
