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

/**
 * Local mirror of `apiFetch` (`ui/src/lib/api.ts`) — duplicated rather than imported, for the
 * same reason the formatter body below is duplicated: this module is ALSO typechecked from
 * the repo-root tsconfig (via `src/services/__tests__/conductor-pass-format-ui-parity.test.ts`,
 * which imports it directly). That config has no DOM lib and no `@/*` path mapping, so an
 * import of `./api` — which touches `window`, `@/types`, and `websocket.ts` — fails there.
 * Keep this in lockstep with `api.ts`'s `apiFetch` if the routing rule ever changes.
 */
async function apiFetch(serverId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const mc = (globalThis as any).window?.mc;
  if (mc?.invokeOnServer && serverId) {
    const method = init.method || 'GET';
    const headers = (init.headers as Record<string, string>) || {};
    let body: any = undefined;
    if (init.body != null) {
      if (typeof init.body === 'string') {
        body = init.body;
      } else {
        // FormData / Blob etc. are not supported by the IPC bridge — fall through to browser fetch.
        const fallbackUrl = new URL(
          '/srv/' + encodeURIComponent(serverId) + path,
          (globalThis as any).window.location.origin,
        ).toString();
        return fetch(fallbackUrl, init);
      }
    }
    const res: any = await mc.invokeOnServer(serverId, { path, method, body, headers });
    if (!res) {
      return new Response(null, { status: 502, statusText: 'invokeOnServer failed' });
    }
    const respHeaders = new Headers();
    const rawHeaders = (res.headers ?? {}) as Record<string, string | string[]>;
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (Array.isArray(v)) v.forEach((x) => respHeaders.append(k, String(x)));
      else if (v != null) respHeaders.set(k, String(v));
    }
    const respBody = typeof res.body === 'string'
      ? res.body
      : res.body == null ? null : JSON.stringify(res.body);
    return new Response(respBody, {
      status: res.status ?? 200,
      statusText: res.statusText ?? '',
      headers: respHeaders,
    });
  }
  if (mc && !serverId) {
    console.warn(
      `[apiFetch] empty serverId for ${path} with a native bridge present — ` +
        `falling back to the local origin. If this is a remote session, its ` +
        `documents/items will appear empty; the session likely lost its serverId.`
    );
  }
  const url = serverId
    ? new URL('/srv/' + encodeURIComponent(serverId) + path, (globalThis as any).window.location.origin).toString()
    : path;
  return fetch(url, init);
}

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
  /** Node-authored "what I concluded and why" for this pass (<=600 chars). Optional so rows
   *  written before the column existed read back as absent rather than empty. */
  summary?: string | null;
  /** True when an OPERATOR kick forced this pass past the fingerprint debounce. Optional so
   *  rows written before the column existed read back as absent rather than false. */
  forced?: boolean | null;
}

/** POST the one-shot conductor kick. Resolves to the server's verdict; a non-2xx or a network
 *  fault RESOLVES (never throws) so the caller can render a failure line instead of exploding. */
export async function kickConductor(
  project: string,
  missionId?: string,
  serverScope: string = 'local',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await apiFetch(serverScope, '/api/conductor/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, missionId }),
    });
    if (!response.ok) {
      let message = `kick failed (${response.status})`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        /* keep the status-code message */
      }
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'kick failed' };
  }
}

/** Both operator levers that hang off orchestrator_config are simple off/on switches with
 *  the same GET/POST contract, so one pair of clients serves both. */
export type LeverLevel = 'off' | 'on';
export type AutoFixLevel = LeverLevel;
export type ExplorerLevel = LeverLevel;

/** Read an off/on lever. DEFAULT 'on' — a failed/absent read resolves to 'on' so the UI
 *  never claims something is held when the backend said nothing. Never throws. */
async function fetchLeverLevel(
  path: string,
  label: string,
  project: string,
  serverScope: string = 'local',
): Promise<{ ok: boolean; level: LeverLevel; error?: string }> {
  try {
    const response = await apiFetch(serverScope, `${path}?project=${encodeURIComponent(project)}`);
    if (!response.ok) return { ok: false, level: 'on', error: `${label} read failed (${response.status})` };
    const data = (await response.json()) as { level?: string };
    return { ok: true, level: data?.level === 'off' ? 'off' : 'on' };
  } catch {
    return { ok: false, level: 'on', error: `${label} read failed` };
  }
}

/** POST a new off/on lever level. Resolves (never throws) so the caller can render the
 *  failure inline; the resolved `level` is the server's stored value, not the request's. */
async function postLeverLevel(
  path: string,
  label: string,
  project: string,
  level: LeverLevel,
  serverScope: string = 'local',
): Promise<{ ok: boolean; level?: LeverLevel; error?: string }> {
  try {
    const response = await apiFetch(serverScope, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, level }),
    });
    if (!response.ok) {
      let message = `${label} failed (${response.status})`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        /* keep the status-code message */
      }
      return { ok: false, error: message };
    }
    const data = (await response.json()) as { level?: string };
    return { ok: true, level: data?.level === 'off' ? 'off' : 'on' };
  } catch {
    return { ok: false, error: `${label} failed` };
  }
}

/**
 * The trailing `serverScope` param on every export below is OPTIONAL, so the existing
 * unscoped callers keep compiling untouched — `ConductorLadder.tsx:64-65` types `LeverStopProps.fetchLevel`
 * as `(project: string) => Promise<...>` and `.postLevel` as `(project, level) => Promise<...>`; passing
 * `fetchAutoFixLevel`/`setAutoFixLevel`/`fetchExplorerLevel`/`setExplorerLevel` (each now `(project,
 * serverScope = 'local')` / `(project, level, serverScope = 'local')`) still satisfies those prop types
 * because a function with fewer required params is assignable to a shorter function type. Same for
 * `kickConductor(project)` at `ConductorLadder.tsx:200`. `npx tsc --noEmit -p ui/tsconfig.json` is clean
 * with this file's new signatures.
 */
/** AUTOFIX (third lever): gates the daemon's repair-forge pass. */
export const fetchAutoFixLevel = (project: string, serverScope: string = 'local') =>
  fetchLeverLevel('/api/autofix/level', 'autofix', project, serverScope);
export const setAutoFixLevel = (project: string, level: AutoFixLevel, serverScope: string = 'local') =>
  postLeverLevel('/api/autofix/level', 'autofix', project, level, serverScope);

/** EXPLORER (fourth lever): gates explore-leaf DISPATCH + the verify-explore filer.
 *  Explores are still filed and still promoted while it is off — only claiming is held. */
export const fetchExplorerLevel = (project: string, serverScope: string = 'local') =>
  fetchLeverLevel('/api/explorer/level', 'explorer', project, serverScope);
export const setExplorerLevel = (project: string, level: ExplorerLevel, serverScope: string = 'local') =>
  postLeverLevel('/api/explorer/level', 'explorer', project, level, serverScope);

/** CAMPAIGN: gates the campaign pass — probe execution, mission forging, and chamber
 *  convenes. A convene is a full multi-general LLM deliberation (the most expensive
 *  automated act in the system), so this lever is the operator's spend kill switch. */
export type CampaignLevel = LeverLevel;
export const fetchCampaignLevel = (project: string, serverScope: string = 'local') =>
  fetchLeverLevel('/api/campaign/level', 'campaign', project, serverScope);
export const setCampaignLevel = (project: string, level: CampaignLevel, serverScope: string = 'local') =>
  postLeverLevel('/api/campaign/level', 'campaign', project, level, serverScope);

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

/**
 * Determine whether a conductor pass row is genuinely inflight (still running and within budget).
 * Returns true only if the pass has not ended (endedAt === null) AND has not exceeded the
 * timeout budget. At exactly CONDUCTOR_NODE_TIMEOUT_MS elapsed, the boundary flips: the row
 * is no longer inflight, and describeUnfinishedPass will call it 'killed (ran out of time)'.
 * This shared gate ensures the badge and sentence agree on the edge.
 */
export function isPassInflight(
  row: Pick<ConductorPassRow, 'startedAt' | 'endedAt'>,
  now: number,
): boolean {
  return row.endedAt === null && now - row.startedAt < CONDUCTOR_NODE_TIMEOUT_MS;
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
    // `summary` participates: two passes whose one-line sentence is identical (the common case
    // for declined / filed-nothing passes) can still have DIFFERENT node reasoning, and only the
    // representative's summary is rendered. Without this, collapsing would hide reasoning.
    // `?? ''` normalizes null and undefined so this stays byte-identical to the backend mirror.
    const fp = `${row.missionId}::${row.arm}::${row.outcome}::${formatted.sentence}::${row.summary ?? ''}`;

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

export interface ConductorJournalQuery {
  missionId?: string;
  limit?: number;
  /** Rows to skip, newest-first. Omitted => page 1 (server default, no OFFSET clause). */
  offset?: number;
}

function journalUrl(project: string, opts?: ConductorJournalQuery): string {
  let url = `/api/conductor/journal?project=${encodeURIComponent(project)}`;
  if (opts?.missionId != null) url += `&missionId=${encodeURIComponent(opts.missionId)}`;
  if (opts?.limit != null) url += `&limit=${encodeURIComponent(String(opts.limit))}`;
  if (opts?.offset != null) url += `&offset=${encodeURIComponent(String(opts.offset))}`;
  return url;
}

export async function fetchConductorJournal(
  project: string,
  opts?: ConductorJournalQuery,
): Promise<ConductorPassRow[]> {
  const response = await fetch(journalUrl(project, opts));
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { rows?: ConductorPassRow[] };
  return data.rows ?? [];
}

export async function fetchConductorJournalWithNicknames(
  project: string,
  opts?: ConductorJournalQuery,
): Promise<{ rows: ConductorPassRow[]; nicknames: Record<string, string>; total: number }> {
  const response = await fetch(journalUrl(project, opts));
  if (!response.ok) return { rows: [], nicknames: {}, total: 0 };
  const data = (await response.json()) as {
    rows?: ConductorPassRow[];
    nicknames?: Record<string, string>;
    total?: number;
  };
  const rows = data.rows ?? [];
  // A server that predates `total` (or a fixture that omits it) must not read as "0 rows" —
  // fall back to what we actually received so the pager stays consistent with the page.
  return { rows, nicknames: data.nicknames ?? {}, total: data.total ?? rows.length };
}
