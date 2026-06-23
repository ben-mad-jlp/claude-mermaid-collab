// NOTE: `ProgressState` / `SessionSummary` / `ZenStructured` mirror the shapes in
// `@/stores/supervisorStore`. They are declared locally here (rather than imported)
// so this pure selector module compiles independently of store edits.
// They are structurally identical to the store's interfaces.
export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface ZenStructured {
  paragraph: string;
  status: 'working' | 'idle' | 'stuck' | 'needs-input';
  question?: string;
  options?: Array<{ label: string; valueToSend: string }>;
  recommended?: number;
  multiSelect?: boolean;
  suggestedAnswers?: string[];
}

export interface SessionSummary {
  project: string;
  session: string;
  progressState: ProgressState;
  paneSeenAt: number;
  updatedAt: number;
  snoozedUntil?: number;
  summaryText?: string;
  firstClause?: string;
  summaryUpdatedAt?: number;
  refreshState?: 'fresh' | 'stale-failing';
  structured?: ZenStructured;
}

export interface ParagraphCardModel {
  key: string;             // `${project}::${session}`
  project: string;
  session: string;
  summary: SessionSummary;
}

/** Every watched session that has an interpreter paragraph, most-recent first.
 *  Recency = max(summaryUpdatedAt, paneSeenAt, updatedAt). Capped at `cap` (≤5). */
export function selectParagraphStack(
  sessionSummaries: Record<string, SessionSummary>,
  cap = 5,
): ParagraphCardModel[] {
  return Object.entries(sessionSummaries)
    .filter(([, s]) => !!(s.structured?.paragraph || s.summaryText || s.firstClause))
    .map(([key, s]) => ({ key, project: s.project, session: s.session, summary: s }))
    .sort((a, b) => recency(b.summary) - recency(a.summary) || a.key.localeCompare(b.key))
    .slice(0, cap);
}

function recency(s: SessionSummary): number {
  return Math.max(s.summaryUpdatedAt ?? 0, s.paneSeenAt ?? 0, s.updatedAt ?? 0);
}

/** Saturation-by-age opacity bucket. Fresh→full; older→progressively muted.
 *  Drives a Tailwind opacity class on the card. Negative ageMs (clock skew)
 *  clamps to the freshest bucket. */
export function ageOpacityClass(summaryUpdatedAt: number | undefined, now: number): string {
  const age = summaryUpdatedAt ? now - summaryUpdatedAt : Infinity;
  if (age < 0) return 'opacity-100';
  if (age < 60_000) return 'opacity-100';
  if (age < 5 * 60_000) return 'opacity-90';
  if (age < 15 * 60_000) return 'opacity-75';
  return 'opacity-60';
}

/** Two-timestamp readout. summaryUpdatedAt drifting far behind paneSeenAt ⇒ the
 *  interpreter is failing to refresh on a moving pane. */
export interface FreshnessReadout {
  label: string;
  failing: boolean;
}

const STALE_SLACK_MS = 3 * 60_000;

export function summaryFreshness(s: SessionSummary, now: number): FreshnessReadout {
  if (s.refreshState === 'stale-failing') {
    return { label: '⚠ summary refresh failing', failing: true };
  }
  // Pane moving but summary stuck well behind → interpreter lagging.
  if (
    s.paneSeenAt &&
    s.summaryUpdatedAt &&
    s.paneSeenAt - s.summaryUpdatedAt > STALE_SLACK_MS
  ) {
    return { label: '⚠ summary refresh failing', failing: true };
  }
  const seen = s.summaryUpdatedAt ?? s.updatedAt ?? 0;
  const mins = seen ? Math.max(0, Math.floor((now - seen) / 60_000)) : 0;
  return { label: `quiet ${mins}m`, failing: false };
}
