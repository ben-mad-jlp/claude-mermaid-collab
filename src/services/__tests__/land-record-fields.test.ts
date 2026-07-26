/**
 * Land-record fields: migration + per-cycle C5 verdict fields.
 *
 * The schema gains five new columns to capture per-cycle state at land time:
 * - nonTerminalServingLeafIds: criterion-serving leaves NOT terminal (accepted/done)
 * - nonTerminalServingLeafCount: count of the above
 * - postLandStatusClean: tree status post-merge (1/0/null)
 * - postLandResidue: raw `git status --porcelain` when non-empty
 * - landPath: routing tag (escalation-land / oi1-reconcile)
 *
 * The migration must add these columns to existing DBs that have the old 5-column DDL.
 * Land recording must capture these fields when available and persist them durably.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-record-fields-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import {
  recordLandCycle,
  getEpicLandRecord,
  nonTerminalServingLeafIds,
  capturePostLandCleanliness,
  addColumnIfMissing,
} from '../epic-land-record-store';
import type { Todo } from '../todo-store';
import { trackingProjectRoot } from '../project-registry';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-record fields — migration + per-cycle captures', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;
  const EPIC = 'epic-fields-test';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-record-fields-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = mkdtempSync(join(tmpdir(), 'land-record-fields-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(persistDir, 'worktrees'),
      persistDir,
      onMainCheckoutViolation: () => { /* spy only */ },
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(persistDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('Migration: old 5-column DB gains five new columns', () => {
    const root = trackingProjectRoot(repo);
    const migTestDir = mkdtempSync(join(tmpdir(), 'land-record-migration-'));
    const dbPath = join(migTestDir, 'epic-land-record-old.db');

    // Create a DB with the OLD 5-column DDL.
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS epic_land_record (
        project TEXT NOT NULL,
        epicId TEXT NOT NULL,
        epicTipSha TEXT NOT NULL,
        landedMergeSha TEXT NOT NULL,
        landedAt INTEGER NOT NULL,
        PRIMARY KEY (project, epicId)
      );
    `);
    // Insert a sample row to verify it survives the migration.
    oldDb.prepare(`
      INSERT INTO epic_land_record (project, epicId, epicTipSha, landedMergeSha, landedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(repo, 'test-epic', 'abc123', 'def456', 1000000);
    oldDb.close();

    // Re-open and manually run the migration via addColumnIfMissing.
    const db = new Database(dbPath);
    addColumnIfMissing(db, 'epic_land_record', 'nonTerminalServingLeafIds', 'TEXT');
    addColumnIfMissing(db, 'epic_land_record', 'nonTerminalServingLeafCount', 'INTEGER');
    addColumnIfMissing(db, 'epic_land_record', 'postLandStatusClean', 'INTEGER');
    addColumnIfMissing(db, 'epic_land_record', 'postLandResidue', 'TEXT');
    addColumnIfMissing(db, 'epic_land_record', 'landPath', 'TEXT');

    // Verify all five new columns exist via PRAGMA.
    const cols = db.query('PRAGMA table_info(epic_land_record)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('nonTerminalServingLeafIds');
    expect(colNames).toContain('nonTerminalServingLeafCount');
    expect(colNames).toContain('postLandStatusClean');
    expect(colNames).toContain('postLandResidue');
    expect(colNames).toContain('landPath');

    // Verify the old row survived the migration.
    const oldRow = db.prepare(`
      SELECT * FROM epic_land_record WHERE project = ? AND epicId = ?
    `).get(repo, 'test-epic') as any;
    expect(oldRow).toBeDefined();
    expect(oldRow.epicTipSha).toBe('abc123');
    expect(oldRow.landedMergeSha).toBe('def456');

    db.close();
    rmSync(migTestDir, { recursive: true, force: true });
  });

  it('nonTerminalServingLeafIds: derives non-terminal criterion-serving leaves correctly', () => {
    // Hand-build a work-graph with one non-terminal criterion-serving leaf.
    const todos: Todo[] = [
      {
        id: 'epic-1',
        kind: 'epic',
        title: 'Epic 1',
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-a',
        servesCriterionIds: ['crit-a'],
        parentId: null,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
      {
        id: 'leaf-1',
        kind: 'leaf',
        title: 'Non-terminal leaf',
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-a',
        servesCriterionIds: ['crit-a'],
        parentId: 'epic-1',
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
      {
        id: 'leaf-2',
        kind: 'leaf',
        title: 'Terminal (accepted) leaf',
        status: 'done',
        acceptanceStatus: 'accepted',
        completed: true,
        servesCriterionId: 'crit-a',
        servesCriterionIds: ['crit-a'],
        parentId: 'epic-1',
        dependsOn: [],
        order: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:00:00Z',
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
    ];

    const nonTerminal = nonTerminalServingLeafIds(todos, 'epic-1');
    expect(nonTerminal).toEqual(['leaf-1']);
  });

  it('capturePostLandCleanliness: returns clean=true on empty status', async () => {
    const result = await capturePostLandCleanliness(repo);
    expect(result).not.toBeNull();
    expect(result!.clean).toBe(true);
    expect(result!.residue).toBeNull();
  });

  it('capturePostLandCleanliness: returns clean=false with residue on dirty status', async () => {
    writeFileSync(join(repo, 'dirty.txt'), 'dirty work\n');
    const result = await capturePostLandCleanliness(repo);
    expect(result).not.toBeNull();
    expect(result!.clean).toBe(false);
    expect(result!.residue).toContain('dirty.txt');
  });

  it('capturePostLandCleanliness: returns null on error', async () => {
    // Non-existent directory.
    const result = await capturePostLandCleanliness('/nonexistent/path/to/repo');
    expect(result).toBeNull();
  });

  it('Real git: land epic with non-terminal criterion-serving leaf persists the fields', async () => {
    // Ensure the epic exists and has work.
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'work.txt'), 'epic work\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: work']);

    // Land the epic.
    const land = await mgr.landEpicToMaster(EPIC);
    expect(land.landed).toBe(true);

    // Simulate capturing the fields as coordinator-land does.
    const todos: Todo[] = [
      {
        id: EPIC,
        kind: 'epic',
        title: EPIC,
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-test',
        servesCriterionIds: ['crit-test'],
        parentId: null,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
      {
        id: 'leaf-nt',
        kind: 'leaf',
        title: 'Non-terminal leaf serving crit-test',
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-test',
        servesCriterionIds: ['crit-test'],
        parentId: EPIC,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
        claimedBy: null,
        claimToken: null,
        claimedAt: null,
        claimLeaseMs: null,
        claim: null,
        approvedAt: null,
        approvedBy: null,
        heldAt: null,
        heldReason: null,
        retryCount: 0,
        completedBy: null,
        objectRef: null,
        decisionRef: null,
        claimProbe: null,
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
    ];

    const epicTipSha = await mgr.epicHeadSha(EPIC).catch(() => null);
    const nonterminalLeaves = nonTerminalServingLeafIds(todos, EPIC);
    const postLandClean = await capturePostLandCleanliness(repo);

    const result = await recordLandCycle(repo, {
      epicId: EPIC,
      epicTipSha,
      landedMergeSha: land.masterSha ?? '',
      landedAt: Date.now(),
      source: 'escalation-land',
      session: 'test-session',
      nonTerminalServingLeafIds: nonterminalLeaves,
      postLandClean,
      landPath: 'escalation-land',
    });

    expect(result.recorded).toBe(true);

    // Read back and verify the fields.
    const record = getEpicLandRecord(repo, EPIC);
    expect(record).not.toBeNull();
    expect(record!.nonTerminalServingLeafCount).toBe(1);
    expect(record!.nonTerminalServingLeafIds).toEqual(['leaf-nt']);
    expect(record!.postLandStatusClean).toBe(1);
    expect(record!.postLandResidue).toBeNull();
    expect(record!.landPath).toBe('escalation-land');
  });
});
