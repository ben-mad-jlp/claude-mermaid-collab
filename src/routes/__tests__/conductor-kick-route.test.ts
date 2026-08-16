// Route test for POST /api/conductor/kick — the operator escape hatch that arms a ONE-SHOT
// force flag for the next conductor pass. Isolates the journal DB via MERMAID_SUPERVISOR_DIR
// before import (conductor-routes pulls the journal module in).
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'conductor-kick-route-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { handleConductorRoutes } from '../conductor-routes.js';
import {
  consumeConductorKick,
  hasPendingConductorKick,
  _resetConductorKicks,
} from '../../services/conductor-kick.js';

const PROJECT = '/tmp/conductor-kick-route-proj';

async function post(body: unknown | undefined, opts?: { raw?: string }): Promise<Response> {
  const url = new URL('http://localhost:9002/api/conductor/kick');
  const res = await handleConductorRoutes(
    new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: opts?.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    url,
  );
  expect(res).not.toBeNull();
  return res!;
}

beforeEach(() => {
  _resetConductorKicks();
});

describe('POST /api/conductor/kick', () => {
  it('arms a one-shot kick for a project + mission', async () => {
    const res = await post({ project: PROJECT, missionId: 'm1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, project: PROJECT, missionId: 'm1', kicked: true });

    expect(consumeConductorKick(PROJECT, 'm1')).toBe(true);
    expect(consumeConductorKick(PROJECT, 'm1')).toBe(false); // one-shot
  });

  it('arms a PROJECT-WIDE kick when no missionId is given', async () => {
    const res = await post({ project: PROJECT });
    expect(res.status).toBe(200);
    expect((await res.json()) as { missionId: string | null }).toMatchObject({ missionId: null });
    expect(consumeConductorKick(PROJECT, 'whichever-mission-the-pass-drives')).toBe(true);
  });

  it('rejects a missing project with 400', async () => {
    const res = await post({ missionId: 'm1' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('project');
    expect(hasPendingConductorKick(PROJECT, 'm1')).toBe(false);
  });

  it('rejects a blank / non-string project with 400', async () => {
    expect((await post({ project: '   ' })).status).toBe(400);
    expect((await post({ project: 42 })).status).toBe(400);
  });

  it('rejects an unparseable body with 400 rather than throwing', async () => {
    const res = await post(undefined, { raw: 'not json at all' });
    expect(res.status).toBe(400);
  });

  it('ignores a blank missionId rather than arming an un-consumable kick', async () => {
    await post({ project: PROJECT, missionId: '  ' });
    // Falls back to the project-wide kick, which any mission's pass can consume.
    expect(consumeConductorKick(PROJECT, 'm-anything')).toBe(true);
  });

  it('does not answer a GET on the kick path (no accidental force from a link)', async () => {
    const url = new URL('http://localhost:9002/api/conductor/kick');
    const res = await handleConductorRoutes(new Request(url.toString(), { method: 'GET' }), url);
    expect(res).toBeNull();
    expect(hasPendingConductorKick(PROJECT, 'm1')).toBe(false);
  });
});
