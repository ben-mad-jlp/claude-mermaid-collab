import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecordingChannelTransport,
  makeChannelNudge,
  type ChannelTransport,
} from '../channel-nudge-transport';
import { recordStatus } from '../session-status-store';

describe('channel-nudge-transport — injected deps', () => {
  it('idle session delivers exactly once and returns sent', async () => {
    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
      isIdle: () => true,
    });

    const result = await nudge('proj', 'sess', 'test message');

    expect(result).toBe('sent');
    expect(recording.deliveries).toHaveLength(1);
    expect(recording.deliveries[0]).toMatchObject({
      project: 'proj',
      session: 'sess',
      text: 'test message',
    });
    expect(typeof recording.deliveries[0].ts).toBe('number');
  });

  it('active session returns busy with zero deliveries', async () => {
    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
      isIdle: () => false,
    });

    const result = await nudge('proj', 'sess', 'test message');

    expect(result).toBe('busy');
    expect(recording.deliveries).toHaveLength(0);
  });

  it('a throwing transport resolves undeliverable instead of rejecting', async () => {
    const throwingTransport: ChannelTransport = {
      async deliver(): Promise<void> {
        throw new Error('delivery failed');
      },
    };
    const nudge = makeChannelNudge({
      transport: throwingTransport,
      isIdle: () => true,
    });

    const result = await nudge('proj', 'sess', 'test message');

    expect(result).toBe('undeliverable');
    // Promise never rejects
    await expect(nudge('proj', 'sess', 'test')).resolves.toBe('undeliverable');
  });

  it('isIdle throwing resolves undeliverable', async () => {
    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
      isIdle: () => {
        throw new Error('check failed');
      },
    });

    const result = await nudge('proj', 'sess', 'test message');

    expect(result).toBe('undeliverable');
    expect(recording.deliveries).toHaveLength(0);
  });
});

describe('channel-nudge-transport — live defaults (getStatus)', () => {
  const projects: string[] = [];
  function tmpProject(): string {
    const p = mkdtempSync(join(tmpdir(), 'cnt-test-'));
    projects.push(p);
    return p;
  }
  afterAll(() => {
    for (const p of projects) rmSync(p, { recursive: true, force: true });
  });

  it('live default isIdle reads getStatus: waiting sends', async () => {
    const project = tmpProject();
    recordStatus(project, 'sess', 'waiting');

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    const result = await nudge(project, 'sess', 'idle message');

    expect(result).toBe('sent');
    expect(recording.deliveries).toHaveLength(1);
    expect(recording.deliveries[0]).toMatchObject({
      project,
      session: 'sess',
      text: 'idle message',
    });
  });

  it('live default isIdle reads getStatus: active is busy', async () => {
    const project = tmpProject();
    recordStatus(project, 'sess', 'active');

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    const result = await nudge(project, 'sess', 'message');

    expect(result).toBe('busy');
    expect(recording.deliveries).toHaveLength(0);
  });

  it('live default isIdle reads getStatus: permission is busy', async () => {
    const project = tmpProject();
    recordStatus(project, 'sess', 'permission');

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    const result = await nudge(project, 'sess', 'message');

    expect(result).toBe('busy');
    expect(recording.deliveries).toHaveLength(0);
  });

  it('live default isIdle reads getStatus: checkpoint_ready is busy', async () => {
    const project = tmpProject();
    recordStatus(project, 'sess', 'checkpoint_ready');

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    const result = await nudge(project, 'sess', 'message');

    expect(result).toBe('busy');
    expect(recording.deliveries).toHaveLength(0);
  });

  it('live default isIdle: unknown session returns undeliverable', async () => {
    const project = tmpProject();

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    const result = await nudge(project, 'unknown-sess', 'message');

    expect(result).toBe('undeliverable');
    expect(recording.deliveries).toHaveLength(0);
  });

  it('live default isIdle: getStatus throwing resolves undeliverable', async () => {
    const project = tmpProject();

    const recording = createRecordingChannelTransport();
    const nudge = makeChannelNudge({
      transport: recording,
    });

    // Pass an invalid project path to force getStatus to throw
    // ABSOLUTE nonexistent path: a relative one resolves against the daemon cwd and the
    // session-status store obligingly mkdirs nonexistent/project/.collab/ INTO THE REPO,
    // littering the main checkout and blocking every dirty-tree-guarded land (bf03a60b).
    const result = await nudge('/nonexistent/project', 'sess', 'message');

    expect(result).toBe('undeliverable');
    expect(recording.deliveries).toHaveLength(0);
  });
});
