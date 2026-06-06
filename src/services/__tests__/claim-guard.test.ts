import { describe, it, expect } from 'vitest';
import { parseProbe, filterClaimable, type ProbeRunner } from '../claim-guard';
import type { Todo } from '../todo-store';

function todo(id: string, claimProbe: string | null): Todo {
  return { id, claimProbe, status: 'ready', dependsOn: [] } as unknown as Todo;
}

describe('parseProbe', () => {
  it('parses tcp://host:port and bare host:port', () => {
    expect(parseProbe('tcp://127.0.0.1:8082')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 8082 });
    expect(parseProbe('localhost:9000')).toEqual({ kind: 'tcp', host: 'localhost', port: 9000 });
  });
  it('parses http(s) urls', () => {
    expect(parseProbe('http://h:8082/health')).toEqual({ kind: 'http', url: 'http://h:8082/health' });
  });
  it('returns null for absent/unparseable specs', () => {
    expect(parseProbe(null)).toBeNull();
    expect(parseProbe('')).toBeNull();
    expect(parseProbe('not a probe')).toBeNull();
  });
});

describe('filterClaimable (claim-time liveness filter — no status write)', () => {
  it('keeps no-probe todos untouched', async () => {
    const todos = [todo('a', null), todo('b', null)];
    expect((await filterClaimable(todos)).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('drops a probe-gated todo while the probe FAILS, keeps it when it PASSES', async () => {
    const downRunner: ProbeRunner = async () => false;
    const upRunner: ProbeRunner = async () => true;
    const todos = [todo('plain', null), todo('gated', 'tcp://h:8082')];
    // service down → gated todo filtered out, plain stays
    expect((await filterClaimable(todos, downRunner)).map((t) => t.id)).toEqual(['plain']);
    // service up → gated todo claimable
    expect((await filterClaimable(todos, upRunner)).map((t) => t.id)).toEqual(['plain', 'gated']);
  });

  it('returns the SAME todo objects (pure filter — never mutates status)', async () => {
    const g = todo('gated', 'tcp://h:1');
    const passed = await filterClaimable([g], async () => true);
    expect(passed[0]).toBe(g);
    expect(passed[0].status).toBe('ready'); // unchanged
  });

  it('probes each todo by its own spec', async () => {
    const runner: ProbeRunner = async (p) => p.port === 1; // only :1 is up
    const todos = [todo('one', 'tcp://h:1'), todo('two', 'tcp://h:2')];
    expect((await filterClaimable(todos, runner)).map((t) => t.id)).toEqual(['one']);
  });
});
