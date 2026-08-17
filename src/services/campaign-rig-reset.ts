/**
 * campaign-rig-reset.ts — reset a rig to a named commit and record member counts.
 *
 * A rig probe runs against a live application with a project open. The reset must not go
 * through the application's own save/open path, so the reset is filesystem-level, then a
 * fresh process, then openProject, and finally the count assertion input: the opened member
 * count and on-disk manifestCount are recorded as two DISTINCT persisted fields so a caller
 * can compare them BEFORE any probe command runs.
 */
import Database from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalProjectRoot, canonicalProjectRootLoose } from './store-paths.ts';
import { openCollabDb, closeCollabDb } from './collab-db.ts';

/** A reset record: persistent state from restoring to a commit and opening the project. */
export interface RigResetRecord {
  id: number;
  probeId: string;
  commitSha: string;
  openedMemberCount: number;
  manifestCount: number;
  resetAt: number;
}

/** Input to reset a rig. */
export interface RigResetInput {
  targetDir: string;
  commitSha: string;
}

/** Project opened in a rig. */
export interface OpenedProject {
  members: string[];
}

/** Opaque handle to a running app instance. */
export type AppHandle = unknown;

/** Injectable dependencies for runRigReset, exactly matching CampaignPassDeps shape. */
export interface RigResetDeps {
  /** Restore the target directory to a named commit. */
  restoreToCommit?: (targetDir: string, commitSha: string) => void | Promise<void>;
  /** Start the app and return an opaque handle. */
  startApp?: (targetDir: string) => AppHandle | Promise<AppHandle>;
  /** Open a project and return the opened member list. */
  openProject?: (handle: AppHandle, targetDir: string) => OpenedProject | Promise<OpenedProject>;
  /** Read the manifest count for the project. */
  readManifestCount?: (targetDir: string) => number | Promise<number>;
  /** Current time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

const RIG_RESET_DDL = `
CREATE TABLE IF NOT EXISTS campaign_rig_reset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probeId TEXT NOT NULL REFERENCES campaign_probe(id) ON DELETE CASCADE,
  commitSha TEXT NOT NULL,
  openedMemberCount INTEGER NOT NULL,
  manifestCount INTEGER NOT NULL,
  resetAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_rig_reset_probe ON campaign_rig_reset(probeId);
`;

/** Module-local prepared marker, mirroring campaign-pass and campaign-store patterns. */
const prepared = new Set<string>();

/**
 * Live default implementations. These were `not wired` throw-stubs when the module first
 * landed, which made the whole rig layer a PLACEBO in production: the pass's per-probe
 * fail-open catch swallowed the throw, so every rig probe silently skipped both its reset
 * and its measurement, with nothing in any log. A rig here is a git checkout that probe
 * commands run against (the probes drive the app themselves), so the live contract is
 * filesystem-level: restore the pinned commit, then read the project manifest from disk.
 */
async function restoreToCommitLive(targetDir: string, commitSha: string): Promise<void> {
  const git = async (...args: string[]): Promise<void> => {
    const p = Bun.spawn(['git', '-C', targetDir, ...args], { stdout: 'ignore', stderr: 'pipe' });
    const code = await p.exited;
    if (code !== 0) {
      const err = await new Response(p.stderr).text();
      throw new Error(`git ${args.join(' ')} failed in ${targetDir}: ${err.trim().slice(0, 300)}`);
    }
  };
  // Refuse an unknown commit up front — a typo'd pin must fail the reset, not restore HEAD.
  await git('cat-file', '-e', `${commitSha}^{commit}`);
  // Detached checkout of the pin, then drop untracked drift. -fd (not -fdx): ignored build
  // artifacts survive so a reset doesn't force expensive regeneration the probes don't test.
  await git('checkout', '-f', commitSha, '--');
  await git('clean', '-fd');
}

/** The probes launch the application themselves; the handle only carries the rig's root. */
function startAppLive(targetDir: string): AppHandle {
  return { targetDir };
}

/** Read the manifest, then report the members actually PRESENT on disk after the restore.
 *  A member declared in project.json but missing as a file shows up as an
 *  openedMemberCount < manifestCount mismatch in the persisted record. */
async function openProjectLive(_handle: AppHandle, targetDir: string): Promise<OpenedProject> {
  const members = await readManifestMembers(targetDir);
  const present: string[] = [];
  for (const m of members) {
    if (existsSync(join(targetDir, m.path))) present.push(m.label);
  }
  return { members: present };
}

async function readManifestCountLive(targetDir: string): Promise<number> {
  return (await readManifestMembers(targetDir)).length;
}

/** Parse project.json's members array. Throws on a missing or shapeless manifest —
 *  a rig without a readable manifest is a failed reset, not a zero-member project. */
async function readManifestMembers(targetDir: string): Promise<Array<{ label: string; path: string }>> {
  const manifestPath = join(targetDir, 'project.json');
  const raw = await Bun.file(manifestPath).text().catch(() => {
    throw new Error(`rig manifest unreadable: ${manifestPath}`);
  });
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.members)) {
    throw new Error(`rig manifest has no members array: ${manifestPath}`);
  }
  return parsed.members as Array<{ label: string; path: string }>;
}

const nowMs = (): number => Date.now();

/**
 * Open the rig reset database and ensure the campaign_rig_reset table exists.
 * Uses the same collab database as campaign-store with an additional module-local DDL.
 */
function openRigResetDb(project: string): Database {
  project = canonicalProjectRoot(project);
  if (!existsSync(project)) {
    throw new Error(`unknown project: ${project}`);
  }

  // Get the database from collab-db (same one campaign-store uses).
  const db = openCollabDb(project);

  // Ensure our table exists (idempotent, runs once per root via prepared marker).
  if (prepared.has(project)) return db;
  db.exec(RIG_RESET_DDL);
  prepared.add(project);
  return db;
}

/**
 * Drop a possibly-stale cached handle (test isolation / after a rebuild).
 * Mirrors campaign-pass's _resetCampaignPassDbCache and campaign-store's _resetCampaignDbCache.
 */
export function _resetRigResetDbCache(project?: string): void {
  if (project) {
    prepared.delete(canonicalProjectRootLoose(project));
    closeCollabDb(project);
  } else {
    prepared.clear();
  }
}

/**
 * Reset a rig to a named commit and record the opened member count and manifest count.
 *
 * Sequence:
 * 1. Guard: verify the probe environment is 'rig' (SELECT from campaign_probe).
 * 2. restoreToCommit(input.targetDir, input.commitSha)
 * 3. startApp(input.targetDir) → AppHandle
 * 4. openProject(handle, input.targetDir) → OpenedProject with members[]
 * 5. readManifestCount(input.targetDir) → number
 * 6. INSERT into campaign_rig_reset, return the record with the inserted rowid.
 *
 * All injected IO steps may be async; every step is awaited. A throw mid-sequence
 * leaves no partial reset record.
 */
export async function runRigReset(
  project: string,
  probeId: string,
  input: RigResetInput,
  deps: RigResetDeps = {},
): Promise<RigResetRecord> {
  const db = openRigResetDb(project);

  // Guard first, before any IO: the probe must exist and have environment === 'rig'.
  const probe = db
    .prepare('SELECT environment FROM campaign_probe WHERE id = ?')
    .get(probeId) as any;

  if (!probe) {
    throw new Error(`unknown probe: ${probeId}`);
  }

  if (probe.environment !== 'rig') {
    throw new Error('rig reset requires a rig-environment probe');
  }

  // Inject live defaults.
  const restoreToCommit = deps.restoreToCommit ?? restoreToCommitLive;
  const startApp = deps.startApp ?? startAppLive;
  const openProject = deps.openProject ?? openProjectLive;
  const readManifestCount = deps.readManifestCount ?? readManifestCountLive;
  const now = deps.now ?? nowMs;

  // Run the four IO steps in order, awaiting each.
  await restoreToCommit(input.targetDir, input.commitSha);
  const handle = await startApp(input.targetDir);
  const opened = await openProject(handle, input.targetDir);
  const manifestCount = await readManifestCount(input.targetDir);

  // All steps succeeded; insert the record.
  const resetAt = now();
  const stmt = db.prepare(`
    INSERT INTO campaign_rig_reset (probeId, commitSha, openedMemberCount, manifestCount, resetAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(probeId, input.commitSha, opened.members.length, manifestCount, resetAt);

  // Return the record with the inserted rowid.
  const lastInsertRowid = db.prepare('SELECT last_insert_rowid() as id').get() as any;
  return {
    id: lastInsertRowid.id,
    probeId,
    commitSha: input.commitSha,
    openedMemberCount: opened.members.length,
    manifestCount,
    resetAt,
  };
}

/**
 * Get the most recent reset record for a probe.
 * Returns null if no reset record exists.
 */
export function getRigResetRecord(project: string, probeId: string): RigResetRecord | null {
  const db = openRigResetDb(project);
  const row = db
    .prepare('SELECT * FROM campaign_rig_reset WHERE probeId = ? ORDER BY resetAt DESC, id DESC LIMIT 1')
    .get(probeId) as any;

  if (!row) return null;

  return {
    id: row.id,
    probeId: row.probeId,
    commitSha: row.commitSha,
    openedMemberCount: row.openedMemberCount,
    manifestCount: row.manifestCount,
    resetAt: row.resetAt,
  };
}

/**
 * List all reset records for a probe, ordered by resetAt then id ascending.
 * Returns an empty array if the probe id is unknown or has no reset records.
 */
export function listRigResetRecords(project: string, probeId: string): RigResetRecord[] {
  const db = openRigResetDb(project);
  const rows = db
    .prepare('SELECT * FROM campaign_rig_reset WHERE probeId = ? ORDER BY resetAt, id')
    .all(probeId) as any[];

  return rows.map((row) => ({
    id: row.id,
    probeId: row.probeId,
    commitSha: row.commitSha,
    openedMemberCount: row.openedMemberCount,
    manifestCount: row.manifestCount,
    resetAt: row.resetAt,
  }));
}
