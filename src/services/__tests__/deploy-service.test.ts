// Runs via `bun test` (deploy-service transitively uses bun:sqlite via worker-ledger).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestSelfDeploy, readSelfDeployStatus, deployStatusPath, deployLogDir } from '../deploy-service';
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

describe('readSelfDeployStatus — deploy-outcome read-model (sidecar-death fix)', () => {
  let logDir: string;
  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'deploy-logs-'));
    process.env.MERMAID_DEPLOY_LOG_DIR = logDir;
  });
  afterEach(() => {
    delete process.env.MERMAID_DEPLOY_LOG_DIR;
    rmSync(logDir, { recursive: true, force: true });
  });

  test('deployLogDir + deployStatusPath honor MERMAID_DEPLOY_LOG_DIR', () => {
    expect(deployLogDir()).toBe(logDir);
    expect(deployStatusPath()).toBe(join(logDir, 'self-deploy-status.json'));
  });

  test('returns null when no status file exists', () => {
    expect(readSelfDeployStatus()).toBeNull();
  });

  test('returns null on malformed JSON', () => {
    writeFileSync(deployStatusPath(), '{not json');
    expect(readSelfDeployStatus()).toBeNull();
  });

  test('returns null when phase is not a known value', () => {
    writeFileSync(deployStatusPath(), JSON.stringify({ phase: 'bogus', ts: 1 }));
    expect(readSelfDeployStatus()).toBeNull();
  });

  test('parses a terminal escalated (Mode-B wedged-main) outcome', () => {
    writeFileSync(
      deployStatusPath(),
      JSON.stringify({ phase: 'done', ok: true, mode: 'full', servedPid: 42, escalated: true, shadow: false, message: 'wedged main; recovered', ts: 123 }),
    );
    const s = readSelfDeployStatus();
    expect(s).not.toBeNull();
    expect(s!.phase).toBe('done');
    expect(s!.ok).toBe(true);
    expect(s!.escalated).toBe(true);
    expect(s!.servedPid).toBe(42);
  });

  test('parses a cosmetic shadow-owned (Mode-C) failure', () => {
    writeFileSync(
      deployStatusPath(),
      JSON.stringify({ phase: 'done', ok: false, mode: 'full', servedPid: 7, escalated: true, shadow: true, message: 'shadow owned port', ts: 9 }),
    );
    const s = readSelfDeployStatus();
    expect(s!.ok).toBe(false);
    expect(s!.shadow).toBe(true);
  });

  test('surfaces a started marker with no terminal write (deploy killed mid-run)', () => {
    writeFileSync(deployStatusPath(), JSON.stringify({ phase: 'started', ok: null, mode: 'hot-swap', ts: 5 }));
    const s = readSelfDeployStatus();
    expect(s!.phase).toBe('started');
    expect(s!.ok).toBeNull();
  });
});
