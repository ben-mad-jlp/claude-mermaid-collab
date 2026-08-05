/**
 * conductorActivity.ts (UI mirror) — a byte-faithful mirror of the backend
 * formatter `src/services/conductor-pass-format.ts`, plus a thin fetch client for
 * the already-shipped route `GET /api/conductor/journal`
 * (`src/routes/conductor-routes.ts`). It exists separately ONLY because the
 * backend module chain (`conductor-pass-format.ts` -> `conductor-pass-journal.ts`)
 * imports `bun:sqlite`, which does not typecheck under the UI's `include: ["src"]`
 * config — same reason `claimability.ts` gives. The formatter BODY is identical;
 * keep it in lockstep with the backend if the rule ever changes.
 */

export interface ConductorFiledRef {
  kind: 'epic' | 'leaf' | 'card';
  id: string;
  title: string;
}

export interface ConductorPassRow {
  id: string;
  project: string;
  missionId: string | null;
  startedAt: number;
  endedAt: number | null;
  arm: string | null;
  criteriaActed: Array<{ criterionId: string; action: string; servedEpicId?: string | null; servedEpicNickname?: string | null }>;
  filed: ConductorFiledRef[] | unknown;
  declined: Array<{ what: string; why: string; entityType?: 'epic' | 'leaf' | 'card'; entityId?: string }>;
  outcome: string | null;
  ran: boolean | null;
}

export interface ConductorPassChip { kind: string; id: string; label: string }
export interface FormattedConductorPass { sentence: string; chips: ConductorPassChip[] }

function isTypedFiledRef(x: unknown): x is ConductorFiledRef {
  return (
    x != null && typeof x === 'object' &&
    ((x as any).kind === 'epic' || (x as any).kind === 'leaf' || (x as any).kind === 'card') &&
    typeof (x as any).id === 'string' && typeof (x as any).title === 'string'
  );
}

/** Mirror of harness-caps.ts CONDUCTOR_NODE_TIMEOUT_MS. Duplicated for the same reason
 *  the formatter body is: importing the backend module chain pulls in `bun:sqlite`. The
 *  parity test (conductor-pass-format-ui-parity.test.ts) fails if the two ever disagree. */
const CONDUCTOR_NODE_TIMEOUT_MS = 1_200_000;

/**
 * Describe an unfinished (endedAt === null) pass.
 *
 * The journal row is written at pass START, so `endedAt === null` covers THREE states:
 * still running, orphaned, and genuinely timed out. This used to report all three as
 * 'killed (ran out of time)' — so a healthy pass 3 minutes into a 20-minute budget was
 * announced as a corpse. On 2026-08-05 that text sent someone investigating a mission
 * that was succeeding: the pass it called killed finished 20 seconds later with outcome
 * 'conducted', having served 5 of 7 criteria.
 *
 * Age against the node budget separates them. Under budget it is in flight and says so;
 * at or past budget it cannot still be legitimately running, which is the only case the
 * original wording was ever right about.
 */
export function describeUnfinishedPass(startedAt: number, now: number): string {
  const ageMs = Math.max(0, now - startedAt);
  if (ageMs >= CONDUCTOR_NODE_TIMEOUT_MS) return 'killed (ran out of time)';
  const mins = Math.floor(ageMs / 60_000);
  return mins >= 1 ? `in flight (${mins}m)` : `in flight (${Math.floor(ageMs / 1000)}s)`;
}

export function formatConductorPass(
  row: ConductorPassRow,
  now: number = Date.now(),
): FormattedConductorPass {
  const parts: string[] = [];
  const chips: ConductorPassChip[] = [];

  parts.push(row.missionId ? `Mission ${row.missionId}` : 'No mission');

  if (row.arm != null) {
    parts.push(`arm: ${row.arm}`);
  }

  if (row.endedAt === null) {
    parts.push(describeUnfinishedPass(row.startedAt, now));
  }

  if (row.criteriaActed.length) {
    const groups = new Map<string, { action: string; servedEpicId: string; label: string; count: number }>();
    const soloClauses: string[] = [];

    for (const c of row.criteriaActed) {
      if (c.servedEpicId) {
        const key = `${c.action}::${c.servedEpicId}`;
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
          if (!existing.label && c.servedEpicNickname) existing.label = c.servedEpicNickname;
        } else {
          groups.set(key, {
            action: c.action,
            servedEpicId: c.servedEpicId,
            label: c.servedEpicNickname || c.servedEpicId.slice(0, 8),
            count: 1,
          });
        }
      } else {
        soloClauses.push(`acted on ${c.criterionId} (${c.action})`);
      }
    }

    const clauses: string[] = [];
    let soloIdx = 0;
    for (const c of row.criteriaActed) {
      if (c.servedEpicId) {
        const key = `${c.action}::${c.servedEpicId}`;
        const g = groups.get(key);
        if (g) {
          const noun = g.count === 1 ? 'criterion' : 'criteria';
          clauses.push(`served ${g.count} ${noun} via epic ${g.label}`);
          chips.push({ kind: 'epic', id: g.servedEpicId, label: g.label });
          groups.delete(key);
        }
      } else {
        clauses.push(soloClauses[soloIdx]);
        soloIdx += 1;
      }
    }
    parts.push(clauses.join('; '));
  }

  if (row.declined.length) {
    const clause = row.declined
      .map((d) => {
        if (d.entityType && d.entityId) {
          chips.push({ kind: d.entityType, id: d.entityId, label: d.entityId });
        }
        return `declined ${d.what} (${d.why})`;
      })
      .join('; ');
    parts.push(clause);
  }

  const typedFiled = Array.isArray(row.filed) && row.filed.every(isTypedFiledRef)
    ? (row.filed as ConductorFiledRef[])
    : null;

  if (typedFiled && typedFiled.length) {
    const clause = typedFiled
      .map((ref) => {
        chips.push({ kind: ref.kind, id: ref.id, label: ref.title });
        return `filed ${ref.kind} ${ref.title}`;
      })
      .join('; ');
    parts.push(clause);
  } else if (row.filed != null && (!Array.isArray(row.filed) || row.filed.length > 0)) {
    parts.push('filed items (legacy record)');
  }

  return { sentence: parts.join('. ') + '.', chips };
}

export interface ConductorPassGroup<T> {
  key: string;
  rows: T[];
  count: number;
  firstStartedAt: number;
  lastStartedAt: number;
  representative: T;
  formatted: FormattedConductorPass;
  arm: string | null;
  outcome: string | null;
  missionId: string | null;
}

export function groupConductorPasses(
  rows: ConductorPassRow[],
  now: number = Date.now(),
): ConductorPassGroup<ConductorPassRow>[] {
  const groups: ConductorPassGroup<ConductorPassRow>[] = [];
  let current: ConductorPassGroup<ConductorPassRow> | null = null;
  let prevFp: string | null = null;

  for (const row of rows) {
    // One clock for the whole grouping pass: sampling Date.now() per row would let two
    // in-flight rows straddle a minute boundary and stop collapsing into one group.
    const formatted = formatConductorPass(row, now);
    const fp = `${row.missionId}::${row.arm}::${row.outcome}::${formatted.sentence}`;

    if (current && fp === prevFp) {
      current.rows.push(row);
      current.count += 1;
      current.lastStartedAt = row.startedAt;
    } else {
      current = {
        key: fp,
        rows: [row],
        count: 1,
        firstStartedAt: row.startedAt,
        lastStartedAt: row.startedAt,
        representative: row,
        formatted,
        arm: row.arm,
        outcome: row.outcome,
        missionId: row.missionId,
      };
      groups.push(current);
    }
    prevFp = fp;
  }

  return groups;
}

export async function fetchConductorJournal(
  project: string,
  opts?: { missionId?: string; limit?: number },
): Promise<ConductorPassRow[]> {
  let url = `/api/conductor/journal?project=${encodeURIComponent(project)}`;
  if (opts?.missionId != null) {
    url += `&missionId=${encodeURIComponent(opts.missionId)}`;
  }
  if (opts?.limit != null) {
    url += `&limit=${encodeURIComponent(String(opts.limit))}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { rows?: ConductorPassRow[] };
  return data.rows ?? [];
}

export async function fetchConductorJournalWithNicknames(
  project: string,
  opts?: { missionId?: string; limit?: number },
): Promise<{ rows: ConductorPassRow[]; nicknames: Record<string, string> }> {
  let url = `/api/conductor/journal?project=${encodeURIComponent(project)}`;
  if (opts?.missionId != null) url += `&missionId=${encodeURIComponent(opts.missionId)}`;
  if (opts?.limit != null) url += `&limit=${encodeURIComponent(String(opts.limit))}`;
  const response = await fetch(url);
  if (!response.ok) return { rows: [], nicknames: {} };
  const data = (await response.json()) as { rows?: ConductorPassRow[]; nicknames?: Record<string, string> };
  return { rows: data.rows ?? [], nicknames: data.nicknames ?? {} };
}
