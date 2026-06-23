// Runs via `bun test` (deploy-service transitively uses bun:sqlite via worker-ledger).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestSelfDeploy } from '../deploy-service';
import { setLeafInflight, _closeLedgerDb } from '../worker-ledger';

let supDir: string;
let repo: string;

/** A temp checkout that PASSES the three eligibility gates so the refuse-while-
 *  inflight guard (which runs AFTER eligibility) is the thing under test. */
function makeSelfRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'self-repo-'));
  writeFileSync(join(r, 'package.json'), JSON.stringify({ name: 'claude-mermaid-collab' }));
  mkdirSync(join(r, 'scripts'), { recursive: true });
  writeFileSync(join(r, 'scripts', 'deploy-desktop.sh'), '#!/bin/bash\ntrue\n');
  return r;
}

beforeEach(() => {
  supDir = mkdtempSync(join(tmpdir(), 'sup-'));
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeLedgerDb();
  repo = makeSelfRepo();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(supDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('requestSelfDeploy — refuse-while-building guard', () => {
  // Only meaningful on the platform the deploy recipe supports; on other OSes the
  // platform gate refuses first and the guard never runs.
  const onDarwin = process.platform === 'darwin' ? test : test.skip;

  onDarwin('refuses with leaves-in-flight when a leaf is running', () => {
    setLeafInflight({ leafId: 'leaf-1', project: repo, nodeKind: 'blueprint' });
    const res = requestSelfDeploy(repo);
    expect(res.ok).toBe(false);
    expect(res.started).toBe(false);
    expect(res.reason).toBe('leaves-in-flight');
    expect(res.inflightLeaves).toEqual(['leaf-1']);
  });

  onDarwin('force bypasses the guard (eligibility still gates spawn)', () => {
    setLeafInflight({ leafId: 'leaf-1', project: repo, nodeKind: 'blueprint' });
    // force skips the guard; the stub script exists so the detached spawn starts.
    const res = requestSelfDeploy(repo, { force: true });
    expect(res.reason).not.toBe('leaves-in-flight');
  });
});
