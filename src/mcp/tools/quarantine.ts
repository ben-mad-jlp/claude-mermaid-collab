/**
 * quarantine_test / list_quarantine — MCP wiring for the flaky-test quarantine ledger.
 *
 * Thin callers of upsertQuarantine/activeQuarantine/listTestQuarantine — no new
 * quarantine semantics, just a manual write/read path alongside the automatic
 * promotion flow in flaky-quarantine.ts.
 */
import { resolveProjectArg } from '../../services/project-registry.js';
import { activeQuarantine, upsertQuarantine } from '../../services/flaky-quarantine.js';
import { listTestQuarantine } from '../../services/worker-ledger.js';
import { resolveQuarantineTestFile } from '../../services/quarantine-test-file.js';

export const quarantineTestToolDef = {
  name: 'quarantine_test',
  description: "Manually quarantine a flaky test: writes a seededFrom:'manual' record to the ledger with a (ttlHours ?? 72)h TTL. Re-reads the row after writing (the ledger write is best-effort/swallow-on-error) and throws if it did not land. A second call for the same (project, test) refreshes the TTL by design.",
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Tracking project (filesystem repo root).' },
      test: { type: 'string', description: 'Test identifier (case title or file path) to quarantine.' },
      reason: { type: 'string', description: 'Optional human-readable reason, returned as metadata only (no ledger column).' },
      ttlHours: { type: 'number', description: 'TTL in hours before this quarantine record expires (default 72).' },
      sha: { type: 'string', description: "Optional sha to record as quarantinedAtSha (default 'manual')." },
    },
    required: ['project', 'test'],
  },
};

export async function quarantineTestHandler(args: any): Promise<string> {
  const { project, test, reason, ttlHours, sha } = args as {
    project?: string;
    test?: string;
    reason?: string;
    ttlHours?: number;
    sha?: string;
  };

  const missing: string[] = [];
  if (!project) missing.push('project');
  if (!test) missing.push('test');
  if (missing.length > 0) {
    throw new Error(`Missing required: ${missing.join(', ')}`);
  }

  const root = resolveProjectArg(project!);
  const now = Date.now();
  const ttlMs = (ttlHours ?? 72) * 3600_000;

  upsertQuarantine(
    {
      project: root,
      test: test!,
      quarantinedAtSha: sha ?? 'manual',
      evidence: { runs: 0, passRuns: 0, failRuns: 0 },
      ttlExpiresAt: now + ttlMs,
      seededFrom: 'manual',
    },
    now,
  );

  const row = activeQuarantine(root, now).find((r) => r.test === test);
  if (!row) {
    throw new Error(`quarantine write did not land for test: ${test}`);
  }

  return JSON.stringify({ ...row, reason: reason ?? null }, null, 2);
}

export const listQuarantineToolDef = {
  name: 'list_quarantine',
  description: 'List quarantined tests for a project. By default only active (TTL-valid) records; pass includeExpired:true to include expired ones too. Each row carries a resolved testFile (best-effort) so a bare case-title row is legible.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Tracking project (filesystem repo root).' },
      includeExpired: { type: 'boolean', description: 'Include expired (TTL-passed) quarantine records (default false).' },
    },
    required: ['project'],
  },
};

export async function listQuarantineHandler(args: any): Promise<string> {
  const { project, includeExpired } = args as { project?: string; includeExpired?: boolean };
  if (!project) throw new Error('Missing required: project');

  const root = resolveProjectArg(project);
  const now = Date.now();
  const rows = includeExpired ? listTestQuarantine(root) : activeQuarantine(root, now);

  return JSON.stringify({
    project: root,
    count: rows.length,
    rows: rows.map((r) => ({
      test: r.test,
      testFile: resolveQuarantineTestFile(root, r.test),
      quarantinedAtSha: r.quarantinedAtSha,
      evidence: r.evidence,
      ttlExpiresAt: r.ttlExpiresAt,
      ttlExpiresAtIso: new Date(r.ttlExpiresAt).toISOString(),
      seededFrom: r.seededFrom,
      createdAt: r.createdAt,
      expired: r.ttlExpiresAt <= now,
    })),
  }, null, 2);
}
