/**
 * eventTaxonomy — the shared severity / icon / token spec for the EventStream
 * (Control-UI vision §4, §6). It is the single source of truth that both the
 * Studio ticker and the Bridge stream tile read, so a given event looks and
 * sorts identically everywhere.
 *
 * IMPORTANT: this taxonomy derives entirely from EXISTING signals — the
 * App.tsx WebSocket switch (live) and supervisorStore.auditByProject (backfill).
 * It introduces NO new ws events and NO polling. `fromWsMessage` and
 * `fromAuditEntry` are the only two adapters; both translate an already-present
 * record into a normalized `StreamEvent`.
 */

import type { AuditEntry } from '@/stores/supervisorStore';

/** Visual severity ramp, matching the semantic Tailwind tokens in index.css. */
export type StreamSeverity = 'danger' | 'warning' | 'info' | 'success' | 'muted';

/**
 * The filter-chip buckets in the EventStream header:
 *  - needs-me: a human decision is required (escalations, stopped daemon)
 *  - blocks:   forward progress is stalled (blocked todos, crashed workers)
 *  - activity: everything else (claims, spawns, completions, artifact churn)
 */
export type StreamCategory = 'needs-me' | 'blocks' | 'activity';

/** A normalized, render-ready event in the ring buffer. */
export interface StreamEvent {
  /** Stable id — used for dedupe across backfill + live, and for highlight-fade. */
  id: string;
  /** Unix epoch millis. */
  ts: number;
  /** Taxonomy key, e.g. `escalation.opened`. */
  type: EventKey;
  severity: StreamSeverity;
  /** Single-glyph icon. */
  icon: string;
  /** Tailwind text-token class (with dark variant). */
  tokenClass: string;
  category: StreamCategory;
  project: string;
  session: string;
  /** One-line human summary. */
  title: string;
  /** Optional longer detail. */
  detail?: string;
  /** Drill-down anchors, when the event maps to one. */
  todoId?: string;
  escalationId?: string;
}

export type EventKey =
  | 'escalation.opened'
  | 'daemon.stopped'
  | 'worker.crashed'
  | 'todo.blocked'
  | 'context.high'
  | 'todo.claimed'
  | 'session.spawned'
  | 'plan.promoted'
  | 'todo.completed'
  | 'escalation.decided'
  | 'artifact.updated';

interface TaxonomyMeta {
  severity: StreamSeverity;
  icon: string;
  tokenClass: string;
  category: StreamCategory;
  label: string;
}

/** The canonical spec. Order here is the documented priority order. */
export const EVENT_TAXONOMY: Record<EventKey, TaxonomyMeta> = {
  'escalation.opened': {
    severity: 'danger',
    icon: '⚠',
    tokenClass: 'text-danger-600 dark:text-danger-400',
    category: 'needs-me',
    label: 'Escalation opened',
  },
  'daemon.stopped': {
    severity: 'danger',
    icon: '⛔',
    tokenClass: 'text-danger-600 dark:text-danger-400',
    category: 'needs-me',
    label: 'Coordinator stopped',
  },
  'worker.crashed': {
    severity: 'danger',
    icon: '✖',
    tokenClass: 'text-danger-600 dark:text-danger-400',
    category: 'blocks',
    label: 'Worker crashed',
  },
  'todo.blocked': {
    severity: 'warning',
    icon: '⊘',
    tokenClass: 'text-warning-600 dark:text-warning-400',
    category: 'blocks',
    label: 'Todo blocked',
  },
  'context.high': {
    severity: 'warning',
    icon: '◷',
    tokenClass: 'text-warning-600 dark:text-warning-400',
    category: 'activity',
    label: 'Context high',
  },
  'todo.claimed': {
    severity: 'info',
    icon: '◔',
    tokenClass: 'text-info-600 dark:text-info-400',
    category: 'activity',
    label: 'Todo claimed',
  },
  'session.spawned': {
    severity: 'info',
    icon: '＋',
    tokenClass: 'text-info-600 dark:text-info-400',
    category: 'activity',
    label: 'Session spawned',
  },
  'plan.promoted': {
    severity: 'info',
    icon: '▸',
    tokenClass: 'text-info-600 dark:text-info-400',
    category: 'activity',
    label: 'Plan promoted',
  },
  'todo.completed': {
    severity: 'success',
    icon: '✓',
    tokenClass: 'text-success-600 dark:text-success-400',
    category: 'activity',
    label: 'Todo completed',
  },
  'escalation.decided': {
    severity: 'success',
    icon: '✓',
    tokenClass: 'text-success-600 dark:text-success-400',
    category: 'activity',
    label: 'Escalation decided',
  },
  'artifact.updated': {
    severity: 'muted',
    icon: '·',
    tokenClass: 'text-gray-500 dark:text-gray-400',
    category: 'activity',
    label: 'Artifact updated',
  },
};

/** Does this stream event match the given filter bucket? `null` = All. */
export function matchesCategory(e: StreamEvent, filter: StreamCategory | null): boolean {
  return filter === null || e.category === filter;
}

function meta(type: EventKey): TaxonomyMeta {
  return EVENT_TAXONOMY[type];
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

/** Build a StreamEvent from a taxonomy key + the per-event specifics. */
function build(
  type: EventKey,
  ts: number,
  parts: { id: string; project: string; session: string; title: string; detail?: string; todoId?: string; escalationId?: string },
): StreamEvent {
  const m = meta(type);
  return {
    id: parts.id,
    ts,
    type,
    severity: m.severity,
    icon: m.icon,
    tokenClass: m.tokenClass,
    category: m.category,
    project: parts.project,
    session: parts.session,
    title: parts.title,
    detail: parts.detail,
    todoId: parts.todoId,
    escalationId: parts.escalationId,
  };
}

/** Artifact-churn ws message types that all fold into `artifact.updated`. */
const ARTIFACT_TYPES = new Set<string>([
  'diagram_updated',
  'document_updated',
  'diagram_created',
  'document_created',
  'design_created',
  'design_updated',
  'spreadsheet_created',
  'spreadsheet_updated',
  'snippet_created',
  'snippet_updated',
  'image_created',
]);

const CONTEXT_HIGH_THRESHOLD = 80;

let wsSeq = 0;

/**
 * Translate a live WebSocket message into a StreamEvent, or `null` when the
 * message carries no fleet-stream signal. Deterministic id where the message
 * supplies one; otherwise a monotonic local sequence keeps inserts unique
 * without relying on Date/Math.random.
 */
export function fromWsMessage(message: unknown): StreamEvent | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, any>;
  const type = m.type as string | undefined;
  if (!type) return null;
  const ts = typeof m.ts === 'number' ? m.ts : typeof m.sent === 'number' ? m.sent : nextTick();
  const project = typeof m.project === 'string' ? m.project : '';
  const session = typeof m.session === 'string' ? m.session : '';

  switch (type) {
    case 'escalation_created':
      return build('escalation.opened', ts, {
        id: m.id ? `esc-${m.id}` : `ws-${wsSeq++}`,
        project: m.project ?? project,
        session: m.session ?? session,
        title: `Escalation — ${m.kind ?? 'decision'} (${basename(m.project ?? project)})`,
        detail: typeof m.questionText === 'string' ? m.questionText : undefined,
        escalationId: typeof m.id === 'string' ? m.id : undefined,
      });

    case 'session_created':
      return build('session.spawned', ts, {
        id: `spawn-${m.session ?? session}-${ts}`,
        project: m.project ?? project,
        session: m.session ?? session,
        title: `Session spawned · ${m.session ?? session}`,
      });

    case 'claude_context_update': {
      const pct = typeof m.contextPercent === 'number' ? m.contextPercent : typeof m.percent === 'number' ? m.percent : undefined;
      if (typeof pct !== 'number' || pct < CONTEXT_HIGH_THRESHOLD) return null;
      return build('context.high', ts, {
        id: `ctx-${m.session ?? session}-${Math.round(pct)}-${ts}`,
        project: m.project ?? project,
        session: m.session ?? session,
        title: `Context ${Math.round(pct)}% · ${m.session ?? session}`,
      });
    }

    case 'claude_session_status': {
      const status = typeof m.status === 'string' ? m.status : '';
      if (status !== 'crashed' && status !== 'stopped' && status !== 'dead') return null;
      return build('worker.crashed', ts, {
        id: `crash-${m.session ?? session}-${ts}`,
        project: m.project ?? project,
        session: m.session ?? session,
        title: `Worker ${status} · ${m.session ?? session}`,
      });
    }

    default:
      if (ARTIFACT_TYPES.has(type)) {
        return build('artifact.updated', ts, {
          id: `art-${type}-${m.id ?? wsSeq++}-${ts}`,
          project,
          session,
          title: `${type.replace(/_/g, ' ')}${m.name ? ` · ${m.name}` : ''}`,
        });
      }
      return null;
  }
}

/** Map an audit-kind onto its taxonomy key (used for the mount-time backfill). */
const AUDIT_KIND_TO_EVENT: Record<string, EventKey> = {
  escalate: 'escalation.opened',
  claim: 'todo.claimed',
  spawn: 'session.spawned',
  complete: 'todo.completed',
  // `override` reads as a human resolving/deciding a prior escalation.
  override: 'escalation.decided',
};

/**
 * Backfill adapter: a historical AuditEntry → StreamEvent. Audit kinds that
 * have no stream meaning (nudge, checkpoint, clear) fold into the muted
 * `artifact.updated` bucket so nothing is silently dropped.
 */
export function fromAuditEntry(entry: AuditEntry): StreamEvent {
  const type = AUDIT_KIND_TO_EVENT[entry.kind] ?? 'artifact.updated';
  let detail: string | undefined;
  let todoId: string | undefined;
  if (entry.detail) {
    try {
      const parsed = JSON.parse(entry.detail);
      if (parsed && typeof parsed === 'object') {
        todoId = typeof parsed.todoId === 'string' ? parsed.todoId : undefined;
        detail = typeof parsed.title === 'string' ? parsed.title : entry.detail;
      } else {
        detail = entry.detail;
      }
    } catch {
      detail = entry.detail;
    }
  }
  return build(type, entry.ts, {
    id: `audit-${entry.id}`,
    project: entry.project,
    session: entry.session,
    title: `${meta(type).label} · ${entry.session}`,
    detail,
    todoId,
  });
}

/** Monotonic fallback tick, seeded off the ring sequence (no Date/Math.random). */
function nextTick(): number {
  return wsSeq++;
}
