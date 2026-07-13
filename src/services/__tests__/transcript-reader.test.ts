import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { recentTurns, transcriptPath } from '../transcript-reader';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fixture(lines: object[]): string {
  const uuid = `test-${mkdtempSync(join(tmpdir(), 'tr-')).split('/').pop()}`;
  const projectDir = mkdtempSync(join(tmpdir(), 'tr-proj-'));
  const bindingPath = `/tmp/.mermaid-collab-binding-${uuid}.json`;
  writeFileSync(bindingPath, JSON.stringify({ claudeSessionId: uuid, project: projectDir, session: 's' }));
  const tp = transcriptPath(projectDir, uuid);
  mkdirSync(dirname(tp), { recursive: true });
  writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  cleanups.push(() => { try { rmSync(bindingPath); } catch {} try { rmSync(tp); } catch {} });
  return uuid;
}

describe('recentTurns', () => {
  test('returns the last N turns in order with correct roles', async () => {
    const uuid = fixture([
      { type: 'user', message: { content: 'hello 1' } },
      { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'reply 1' }] } },
      { type: 'user', message: { content: 'hello 2' } },
      { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'reply 2' }] } },
    ]);
    const all = await recentTurns(uuid, 20);
    expect(all.found).toBe(true);
    expect(all.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(all.turns[0].text).toBe('hello 1');
    expect(all.turns[3].text).toBe('reply 2');

    const last2 = await recentTurns(uuid, 2);
    expect(last2.turns.map((t) => t.text)).toEqual(['hello 2', 'reply 2']);
  });

  test('returns found:false for a missing file', async () => {
    const res = await recentTurns('no-such-session-uuid-xyz', 10);
    expect(res.found).toBe(false);
    expect(res.turns).toEqual([]);
  });
});
