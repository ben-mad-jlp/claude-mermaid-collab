import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'bridge-snapshot-readonly-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { buildBridgeSnapshot } from '../bridge-snapshot';
import { createTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'bridge-snapshot-readonly-'));
});

afterEach(() => {
  _closeProject(project);
  _closeLedgerDb();
  rmSync(project, { recursive: true, force: true });
});

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)/i;

interface SqlWriteRecorderResult<T> {
  result: T;
  writes: string[];
}

async function withSqlWriteRecorder<T>(
  fn: () => Promise<T>,
): Promise<SqlWriteRecorderResult<T>> {
  // Save original methods
  const origExec = Database.prototype.exec as (sql: string) => void;
  const origRun = Database.prototype.run as (sql: string, ...args: unknown[]) => void;
  const origPrepare = Database.prototype.prepare;
  const origQuery = Database.prototype.query;

  const writes: string[] = [];
  let result: T;

  try {
    // Patch Database.prototype.exec
    (Database.prototype.exec as any) = function (this: any, sql: string) {
      if (WRITE_RE.test(sql)) {
        writes.push(sql);
      }
      return origExec.call(this, sql);
    };

    // Patch Database.prototype.run
    (Database.prototype.run as any) = function (this: any, sql: string, ...args: unknown[]) {
      if (WRITE_RE.test(sql)) {
        writes.push(sql);
      }
      return origRun.call(this, sql, ...args);
    };

    // Patch Database.prototype.prepare
    (Database.prototype.prepare as any) = function (this: any, sql: string) {
      const stmt = origPrepare.call(this, sql);
      if (WRITE_RE.test(sql)) {
        const origStmtRun = (stmt as any).run;
        (stmt as any).run = function (this: any, ...args: unknown[]) {
          writes.push(sql);
          return origStmtRun.apply(this, args);
        };
      }
      return stmt;
    };

    // Patch Database.prototype.query
    (Database.prototype.query as any) = function (this: any, sql: string) {
      const stmt = origQuery.call(this, sql);
      if (WRITE_RE.test(sql)) {
        const origStmtRun = (stmt as any).run;
        (stmt as any).run = function (this: any, ...args: unknown[]) {
          writes.push(sql);
          return origStmtRun.apply(this, args);
        };
      }
      return stmt;
    };

    result = await fn();
  } finally {
    // Restore all original methods
    (Database.prototype.exec as any) = origExec;
    (Database.prototype.run as any) = origRun;
    (Database.prototype.prepare as any) = origPrepare;
    (Database.prototype.query as any) = origQuery;
  }

  return { result, writes };
}

describe('bridge-snapshot readonly verification', () => {
  test('buildBridgeSnapshot performs zero writes to project stores', async () => {
    // Warm the connections to allow open-time DDL/WAL writes outside the measured window
    await buildBridgeSnapshot(project, { serverIds: ['warm'] });

    // Seed one todo and one escalation
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'seed',
      kind: 'leaf',
    });

    createEscalation({
      project,
      session: 's1',
      kind: 'test',
      questionText: 'Q',
      serverId: 'server-1',
      audience: 'human',
    });

    // Measure buildBridgeSnapshot with recorder
    const { writes } = await withSqlWriteRecorder(() =>
      buildBridgeSnapshot(project, { serverIds: ['server-1'] }),
    );

    // Assert the array itself (not a count-based assertion)
    expect(writes).toEqual([]);
  });

  test('the write recorder catches a write injected during the measured window', async () => {
    // Warm the connections
    await buildBridgeSnapshot(project, { serverIds: ['warm'] });

    // Measure with a dep that performs a write
    const { writes } = await withSqlWriteRecorder(() =>
      buildBridgeSnapshot(project, {
        serverIds: ['server-1'],
        deps: {
          specCoverage: () => {
            // Perform a real write to prove the recorder works
            const probe = new Database(':memory:');
            probe.exec('CREATE TABLE t (id INTEGER)');
            probe.prepare('INSERT INTO t (id) VALUES (?)').run(1);
            probe.close();
            return { total: 0, covered: 0, partial: 0, uncovered: 0, stale: 0, byObject: [] };
          },
        },
      }),
    );

    // Assert the write was recorded
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((w) => /INSERT/i.test(w))).toBe(true);
  });

  test('bridge-snapshot.ts contains no git/child_process/unlanded-epics/deploy-status reach', async () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'bridge-snapshot.ts'),
      'utf8',
    );

    // Negative list: forbidden symbols that must not appear
    const forbiddenSymbols = [
      'execFileSync',
      'execSync',
      'spawnSync',
      'spawn',
      'node:child_process',
      'getWorktreeManager',
      'listUnlandedEpics',
      'listStaleWorktrees',
      'systemStatus',
      'selfDeployEligibility',
      'readSelfDeployStatus',
      'epicHeadSha',
      'isEpicLandedInGit',
    ];

    for (const symbol of forbiddenSymbols) {
      expect(src.includes(symbol)).toBe(false);
    }

    // Positive, non-vacuous import-allowlist check
    const importMatches = Array.from(
      src.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';?$/gm),
    );

    // Guard against empty/renamed file
    expect(importMatches.length).toBeGreaterThan(0);

    const allowedModules = new Set([
      './supervisor-store.js',
      './todo-store.js',
      './mission-store.js',
      './spec-coverage.js',
    ]);

    const allowedImports = new Set([
      'listWatchedProjects',
      'WatchedProject',
      'listOpenEscalations',
      'Escalation',
      'listTodos',
      'Todo',
      'listMissions',
      'MissionSummary',
      'specCoverage',
      'CoverageRollup',
    ]);

    for (const match of importMatches) {
      const modulePath = match[2]!;
      const imports = match[1]!;

      // Verify module is in allowlist
      expect(allowedModules.has(modulePath)).toBe(true);

      // Verify all named imports are in allowlist
      const namedImports = imports
        .split(',')
        .map((i) => i.trim().replace(/^type\s+/, '').trim());

      for (const named of namedImports) {
        expect(allowedImports.has(named)).toBe(true);
      }
    }
  });
});
