/**
 * campaign-store.ts — durable storage for campaigns and their probes.
 *
 * A CAMPAIGN is a collection of PROBES (deterministic checks) that can be run
 * to validate a system state. Each probe has a kind ('command'), environment
 * ('worktree'), and an optional command to execute. Probes maintain verdicts
 * ('not-run', 'pass', 'fail') and can depend on other probes.
 *
 * Campaigns and probes live in the project's consolidated .collab/collab.db,
 * created and migrated on first use via module-local idempotent DDL.
 */
import Database from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { canonicalProjectRoot, canonicalProjectRootLoose } from './store-paths.ts';
import { openCollabDb, closeCollabDb, _closeAllCollabDbs } from './collab-db.ts';

/** Closed union of probe kinds (v1: only 'command'). Future widening happens here alone. */
export type ProbeKind = 'command';

/** Closed union of probe environments ('worktree', 'rig'). Future widening happens here alone. */
export type ProbeEnvironment = 'worktree' | 'rig';

/** Closed union of probe verdicts. */
export type ProbeVerdict = 'not-run' | 'pass' | 'fail';

/** Recorded verdicts (exclude 'not-run' which is a probe state, never a verdict). */
export type RecordedVerdict = Exclude<ProbeVerdict, 'not-run'>;

/**
 * Rig run verdict — a RUN OUTCOME, not a stored probe state. A 'rig-fault' run leaves the
 * probe's stored verdict (ProbeVerdict) untouched, so rig-fault is separate from the closed
 * union of stored verdicts ('not-run', 'pass', 'fail') and the campaign_probe.verdict CHECK.
 */
export type RigRunVerdict = RecordedVerdict | 'rig-fault';

/** A campaign row: the container for a set of probes. */
export interface CampaignRow {
  id: string;
  project: string;
  title: string;
  createdAt: number;
}

/** A probe row: a deterministic check within a campaign. */
export interface CampaignProbe {
  id: string;
  campaignId: string;
  kind: ProbeKind;
  environment: ProbeEnvironment;
  dependsOn: string[];
  declaredPaths: string[];
  verdict: ProbeVerdict;
  command: string | null;
  createdAt: number;
}

/** Input shape for creating/adding a probe. */
export interface ProbeInput {
  kind: ProbeKind;
  environment: ProbeEnvironment;
  command?: string | null;
  dependsOn?: string[];
  declaredPaths?: string[];
}

/** A recorded verdict row: provenance for a probe's test result. */
export interface ProbeVerdictRecord {
  id: number;
  probeId: string;
  verdict: RecordedVerdict;
  environment: ProbeEnvironment;
  commitSha: string;
  evidence: string | null;
  recordedAt: number;
}

/** Input shape for recording a probe verdict. */
export interface ProbeVerdictInput {
  probeId: string;
  verdict: RecordedVerdict;
  environment: ProbeEnvironment;
  commitSha: string;
  evidence?: string | null;
}

/** Factored DDL for campaign_probe table (used in CAMPAIGN_SCHEMA and migration). */
const PROBE_TABLE_DDL = `
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('command')),
  environment TEXT NOT NULL CHECK (environment IN ('worktree','rig')),
  dependsOn TEXT NOT NULL DEFAULT '[]',
  declaredPaths TEXT NOT NULL DEFAULT '[]',
  verdict TEXT NOT NULL DEFAULT 'not-run' CHECK (verdict IN ('not-run', 'pass', 'fail')),
  command TEXT,
  createdAt INTEGER NOT NULL
`;

/** Factored DDL for campaign_probe_verdict table (used in CAMPAIGN_SCHEMA and migration). */
const PROBE_VERDICT_TABLE_DDL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  probeId TEXT NOT NULL REFERENCES campaign_probe(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail')),
  environment TEXT NOT NULL CHECK (environment IN ('worktree','rig')),
  commitSha TEXT NOT NULL,
  evidence TEXT,
  recordedAt INTEGER NOT NULL
`;

const CAMPAIGN_SCHEMA = `
CREATE TABLE IF NOT EXISTS campaign (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign_probe (${PROBE_TABLE_DDL});
CREATE INDEX IF NOT EXISTS idx_campaign_probe_campaign ON campaign_probe(campaignId);
CREATE TABLE IF NOT EXISTS campaign_probe_verdict (${PROBE_VERDICT_TABLE_DDL});
CREATE INDEX IF NOT EXISTS idx_campaign_probe_verdict_probe ON campaign_probe_verdict(probeId);
`;

/**
 * Roots whose DDL has already run in this process. The HANDLE cache lives in
 * collab-db, which owns the file — a second cache here lets _resetCampaignDbCache
 * clear the prepared marker along with the handle.
 */
const prepared = new Set<string>();

/**
 * Idempotent widening migration for campaign_probe and campaign_probe_verdict tables.
 * On a fresh database CAMPAIGN_SCHEMA creates the widened schema. On a live database
 * with narrow CHECK clauses, this function rebuilds the tables in-place to accept 'rig'.
 *
 * Foreign keys are ON for the database handle (enforceForeignKeys in collab-db), so
 * dropping campaign_probe would cascade-delete all campaign_probe_verdict rows. The
 * migration: (1) disables FK, (2) rebuilds child table first, then parent, (3) restores FK.
 * Rebuilding via the standard sqlite pattern: CREATE TABLE _new, INSERT SELECT explicit columns,
 * DROP old, RENAME _new, recreate indexes. Columns are copied explicitly to guard against
 * future additions.
 */
function widenProbeEnvironmentChecks(db: Database): void {
  // Check which tables need widening by reading their current DDL.
  const tableInfo = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('campaign_probe','campaign_probe_verdict')")
    .all() as Array<{ name: string; sql: string }>;

  const needsWiden = tableInfo.filter((t) => !t.sql.includes("'rig'"));
  if (needsWiden.length === 0) {
    return; // Both tables already accept 'rig', no-op.
  }

  // Disable foreign key constraints for the rebuild.
  db.prepare('PRAGMA foreign_keys = OFF').run();
  try {
    db.exec('BEGIN');
    try {
      // Rebuild campaign_probe_verdict first (child table).
      const verdictTable = needsWiden.find((t) => t.name === 'campaign_probe_verdict');
      if (verdictTable) {
        db.exec(`
          CREATE TABLE campaign_probe_verdict_new (${PROBE_VERDICT_TABLE_DDL});
          INSERT INTO campaign_probe_verdict_new (id, probeId, verdict, environment, commitSha, evidence, recordedAt)
          SELECT id, probeId, verdict, environment, commitSha, evidence, recordedAt FROM campaign_probe_verdict;
          DROP TABLE campaign_probe_verdict;
          ALTER TABLE campaign_probe_verdict_new RENAME TO campaign_probe_verdict;
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_campaign_probe_verdict_probe ON campaign_probe_verdict(probeId)');
      }

      // Rebuild campaign_probe (parent table).
      const probeTable = needsWiden.find((t) => t.name === 'campaign_probe');
      if (probeTable) {
        db.exec(`
          CREATE TABLE campaign_probe_new (${PROBE_TABLE_DDL});
          INSERT INTO campaign_probe_new (id, campaignId, kind, environment, dependsOn, verdict, command, createdAt)
          SELECT id, campaignId, kind, environment, dependsOn, verdict, command, createdAt FROM campaign_probe;
          DROP TABLE campaign_probe;
          ALTER TABLE campaign_probe_new RENAME TO campaign_probe;
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_campaign_probe_campaign ON campaign_probe(campaignId)');
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    // Restore foreign key constraints.
    db.prepare('PRAGMA foreign_keys = ON').run();
  }
}

/**
 * Idempotent migration to add declaredPaths column to campaign_probe table.
 * Uses PRAGMA table_info to check if the column exists; adds it if missing.
 * Safe to call multiple times and on tables that already have the column.
 */
function addProbeDeclaredPathsColumn(db: Database): void {
  const tableInfo = db
    .prepare("PRAGMA table_info(campaign_probe)")
    .all() as Array<{ name: string }>;

  const hasColumn = tableInfo.some((col) => col.name === 'declaredPaths');
  if (hasColumn) {
    return; // Column already exists, no-op.
  }

  // Add the column with a default value.
  db.prepare("ALTER TABLE campaign_probe ADD COLUMN declaredPaths TEXT NOT NULL DEFAULT '[]'").run();
}

function openCampaignDb(project: string): Database {
  // Key the cache on the SAME canonical root canonicalProjectRoot resolves to.
  project = canonicalProjectRoot(project);
  if (!existsSync(project)) {
    throw new Error(`unknown project: ${project}`);
  }
  // Campaign control state lives WITH campaigns in the project's consolidated database.
  // openCollabDb owns the handle cache and performs the one-time move + foreign-key setup.
  const db = openCollabDb(project);
  if (prepared.has(project)) return db;

  // Idempotent DDL: runs once per prepared handle, no-ops on later calls.
  db.exec(CAMPAIGN_SCHEMA);

  // Idempotent migration: widen CHECK clauses on existing tables to accept 'rig'.
  widenProbeEnvironmentChecks(db);

  // Idempotent migration: add declaredPaths column to campaign_probe if missing.
  addProbeDeclaredPathsColumn(db);

  prepared.add(project);
  return db;
}

/** Drop a possibly-stale cached handle (test isolation / after a rebuild). */
export function _resetCampaignDbCache(project?: string): void {
  if (project) {
    // MUST canonicalise exactly as openCampaignDb does.
    prepared.delete(canonicalProjectRootLoose(project));
    closeCollabDb(project);
  } else {
    prepared.clear();
    _closeAllCollabDbs();
  }
}

const nowMs = (): number => Date.now();

/** Validate a probe input: fail loud, no defaults. Environment and kind are required
 *  and must be in the closed unions. This is the FIRST wall; CHECK constraints in the
 *  schema are the SECOND, independent wall. */
function assertProbeInput(input: ProbeInput): void {
  if (!input.environment) {
    throw new Error('probe environment is required');
  }
  const validEnvironments: ProbeEnvironment[] = ['worktree', 'rig'];
  if (!validEnvironments.includes(input.environment)) {
    throw new Error(`invalid probe environment: ${input.environment}`);
  }
  const validKinds: ProbeKind[] = ['command'];
  if (!validKinds.includes(input.kind)) {
    throw new Error(`invalid probe kind: ${input.kind}`);
  }
  if (input.declaredPaths !== undefined) {
    if (!Array.isArray(input.declaredPaths)) {
      throw new Error('probe declaredPaths must be an array');
    }
    for (const entry of input.declaredPaths) {
      if (typeof entry !== 'string') {
        throw new Error('probe declaredPaths entries must be strings');
      }
      if (!entry.trim()) {
        throw new Error('probe declaredPaths entries must not be empty');
      }
    }
  }
}

/** Validate a verdict input: fail loud, no defaults. Environment and commitSha are required.
 *  This is the FIRST wall; CHECK constraints in the schema are the SECOND, independent wall. */
function assertVerdictInput(input: ProbeVerdictInput): void {
  if (!input.environment || !input.environment.trim()) {
    throw new Error('probe verdict environment is required');
  }
  const validEnvironments: ProbeEnvironment[] = ['worktree', 'rig'];
  if (!validEnvironments.includes(input.environment)) {
    throw new Error(`invalid probe verdict environment: ${input.environment}`);
  }
  if (!input.commitSha || !input.commitSha.trim()) {
    throw new Error('probe verdict commitSha is required');
  }
  if (!input.verdict || !['pass', 'fail'].includes(input.verdict)) {
    throw new Error(`invalid probe verdict: ${input.verdict}`);
  }
  if (!input.probeId) {
    throw new Error('probe verdict probeId is required');
  }
}

/**
 * Create a campaign and its probes in one transaction. Validates every probe BEFORE
 * the first INSERT, so a bad probe leaves zero rows.
 */
export function createCampaign(
  project: string,
  input: { title: string; probes?: ProbeInput[] },
): CampaignRow {
  const probes = input.probes ?? [];

  // Validate all probes before any write.
  for (const probe of probes) {
    assertProbeInput(probe);
  }

  const db = openCampaignDb(project);
  const campaignId = randomUUID();
  const ts = nowMs();

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO campaign (id, project, title, createdAt) VALUES (?, ?, ?, ?)')
      .run(campaignId, canonicalProjectRoot(project), input.title, ts);

    for (const probe of probes) {
      db.prepare(
        'INSERT INTO campaign_probe (id, campaignId, kind, environment, dependsOn, declaredPaths, verdict, command, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        randomUUID(),
        campaignId,
        probe.kind,
        probe.environment,
        JSON.stringify(probe.dependsOn ?? []),
        JSON.stringify(probe.declaredPaths ?? []),
        'not-run',
        probe.command ?? null,
        ts,
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    id: campaignId,
    project: canonicalProjectRoot(project),
    title: input.title,
    createdAt: ts,
  };
}

/**
 * Get a campaign by id, or null if not found.
 */
export function getCampaign(project: string, campaignId: string): CampaignRow | null {
  const db = openCampaignDb(project);
  const row = db.prepare('SELECT * FROM campaign WHERE id = ?').get(campaignId) as any;
  return row ? {
    id: row.id,
    project: row.project,
    title: row.title,
    createdAt: row.createdAt,
  } : null;
}

/**
 * List all probes for a campaign, ordered by createdAt then id.
 * dependsOn and declaredPaths are parsed from JSON to string[].
 */
export function listProbes(project: string, campaignId: string): CampaignProbe[] {
  const db = openCampaignDb(project);
  const rows = db
    .prepare('SELECT * FROM campaign_probe WHERE campaignId = ? ORDER BY createdAt, id')
    .all(campaignId) as any[];

  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind as ProbeKind,
    environment: row.environment as ProbeEnvironment,
    dependsOn: JSON.parse(row.dependsOn),
    declaredPaths: JSON.parse(row.declaredPaths),
    verdict: row.verdict as ProbeVerdict,
    command: row.command,
    createdAt: row.createdAt,
  }));
}

/**
 * Add a probe to an existing campaign. Validates the input and throws on error.
 */
export function addProbe(project: string, campaignId: string, input: ProbeInput): CampaignProbe {
  assertProbeInput(input);

  const db = openCampaignDb(project);
  const probeId = randomUUID();
  const ts = nowMs();

  db.prepare(
    'INSERT INTO campaign_probe (id, campaignId, kind, environment, dependsOn, declaredPaths, verdict, command, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    probeId,
    campaignId,
    input.kind,
    input.environment,
    JSON.stringify(input.dependsOn ?? []),
    JSON.stringify(input.declaredPaths ?? []),
    'not-run',
    input.command ?? null,
    ts,
  );

  return {
    id: probeId,
    campaignId,
    kind: input.kind,
    environment: input.environment,
    dependsOn: input.dependsOn ?? [],
    declaredPaths: input.declaredPaths ?? [],
    verdict: 'not-run',
    command: input.command ?? null,
    createdAt: ts,
  };
}

/**
 * Record a probe verdict with provenance (environment and commit sha). Validates the input
 * and throws on error before any INSERT. On success, updates campaign_probe.verdict and
 * returns the recorded verdict row.
 */
export function recordProbeVerdict(project: string, input: ProbeVerdictInput): ProbeVerdictRecord {
  assertVerdictInput(input);

  const db = openCampaignDb(project);
  const ts = nowMs();

  db.exec('BEGIN');
  try {
    // Insert the provenance row into campaign_probe_verdict.
    const insertStmt = db.prepare(
      'INSERT INTO campaign_probe_verdict (probeId, verdict, environment, commitSha, evidence, recordedAt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertStmt.run(
      input.probeId,
      input.verdict,
      input.environment,
      input.commitSha,
      input.evidence ?? null,
      ts,
    );

    // Update the campaign_probe.verdict to match the recorded verdict.
    db.prepare('UPDATE campaign_probe SET verdict = ? WHERE id = ?').run(input.verdict, input.probeId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Return the recorded verdict row with lastInsertRowid.
  const lastInsertRowid = db.prepare('SELECT last_insert_rowid() as id').get() as any;
  return {
    id: lastInsertRowid.id,
    probeId: input.probeId,
    verdict: input.verdict,
    environment: input.environment,
    commitSha: input.commitSha,
    evidence: input.evidence ?? null,
    recordedAt: ts,
  };
}

/**
 * List all recorded verdicts for a probe, ordered by recordedAt then id.
 * Returns an empty array if the probe id is unknown.
 */
export function listProbeVerdicts(project: string, probeId: string): ProbeVerdictRecord[] {
  const db = openCampaignDb(project);
  const rows = db
    .prepare('SELECT * FROM campaign_probe_verdict WHERE probeId = ? ORDER BY recordedAt, id')
    .all(probeId) as any[];

  return rows.map((row) => ({
    id: row.id,
    probeId: row.probeId,
    verdict: row.verdict as RecordedVerdict,
    environment: row.environment as ProbeEnvironment,
    commitSha: row.commitSha,
    evidence: row.evidence,
    recordedAt: row.recordedAt,
  }));
}

/**
 * Reset a probe's verdict to 'not-run', clearing its previous verdict state.
 * This primitive is a reset state change with no provenance row: it writes nothing to
 * campaign_probe_verdict and only updates campaign_probe.verdict.
 */
export function resetProbeVerdict(project: string, probeId: string): void {
  const db = openCampaignDb(project);
  db.prepare('UPDATE campaign_probe SET verdict = ? WHERE id = ?').run('not-run', probeId);
}

export { deriveFront, campaignFront } from './campaign-front.ts';
