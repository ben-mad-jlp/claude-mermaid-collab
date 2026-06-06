/**
 * Profile L4a — DETECT: the general-overuse accumulator (fd052733, stage 1).
 *
 * Leaning on the `general` pool IS the signal that a domain wants its own pack
 * (decision e8fddf63). This module is the pure, testable substrate that makes that
 * signal concrete: it accumulates per-project the todos that ROUTED to `general`
 * plus their file/dir/ext patterns, clusters them by signature, and emits a
 * profile-opportunity SIGNAL when a cluster crosses a calibrated threshold AND no
 * existing tech-pack / routing rule already covers it.
 *
 * This is EFFICIENCY, not correctness — the build123d wave completed with ZERO
 * failures, so general-overuse only means "we could start warmer", never "work is
 * failing". Hence the threshold is conservative and env-tunable
 * (`MERMAID_GENERAL_OVERUSE_THRESHOLD`), and the signal is advisory: it feeds the
 * L4c DRAFT / L4d APPROVE human gate, it never auto-applies anything.
 *
 * Storage is a small JSON file at `<project>/.collab/profile-signals.json`. It is
 * pure and side-effect-light: a missing/corrupt file reads as "no signals" and
 * nothing here throws into a caller's hot path.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inferProfileType } from '../config/agent-profiles';
import { inferTypeFromManifest } from '../config/project-manifest';

/** Conservative default: a cluster needs this many DISTINCT general-routed todos
 *  before it's worth proposing a pack. Overridable via
 *  `MERMAID_GENERAL_OVERUSE_THRESHOLD` (efficiency, not correctness — keep it high
 *  enough to ignore noise). */
export const DEFAULT_GENERAL_OVERUSE_THRESHOLD = 4;

/** The active threshold: the env override when it is a finite integer >= 1, else
 *  the conservative default. A bad/zero/negative env value is ignored (never
 *  lets a misconfiguration fire a signal on a single todo). */
export function generalOveruseThreshold(): number {
  const raw = process.env.MERMAID_GENERAL_OVERUSE_THRESHOLD;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_GENERAL_OVERUSE_THRESHOLD;
}

/** One recorded routed-to-`general` event. */
export interface RoutingSignal {
  /** The work-graph todo that routed to general. */
  todoId: string;
  /** The file-signature key this event clustered under (extensions, else dirs). */
  key: string;
  /** Touched files (deduped) — kept so DRAFT can derive pathRules + show evidence. */
  files: string[];
  /** The pool/worker session that emitted it (best-effort provenance). */
  session: string | null;
  createdAt: string;
}

/** A cluster of general-routed events sharing a file signature, with no pack. */
export interface ProfileOpportunity {
  /** Cluster key (sorted extensions, e.g. `parts,step`; else `dir:<dirs>`). */
  key: string;
  /** Distinct todo ids in the cluster (count = `todoIds.length`). */
  todoIds: string[];
  /** Distinct file extensions observed across the cluster (no dot). */
  exts: string[];
  /** Distinct first-path-segment dirs observed across the cluster. */
  dirs: string[];
  /** A few representative file paths (evidence for the draft / card). */
  sampleFiles: string[];
}

interface SignalsFile {
  version: number;
  signals: RoutingSignal[];
  /** Cluster keys already emitted as a signal — so a poll never re-fires a cluster
   *  that was already surfaced (the "deduped signal" requirement). */
  emitted: string[];
}

// ---------------------------------------------------------------------------
// Store (per-project JSON, serialized writes)
// ---------------------------------------------------------------------------

function signalsPath(project: string): string {
  return join(project, '.collab', 'profile-signals.json');
}

function readStore(project: string): SignalsFile {
  try {
    const path = signalsPath(project);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && Array.isArray(parsed.signals)) {
        return {
          version: parsed.version ?? 1,
          signals: parsed.signals as RoutingSignal[],
          emitted: Array.isArray(parsed.emitted) ? (parsed.emitted as string[]) : [],
        };
      }
    }
  } catch {
    /* fall through to empty */
  }
  return { version: 1, signals: [], emitted: [] };
}

function writeStore(project: string, file: SignalsFile): void {
  const path = signalsPath(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
}

// Per-project serialized write lock (mirrors friction-store / todo-store).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

// ---------------------------------------------------------------------------
// File-signature derivation
// ---------------------------------------------------------------------------

/** Lowercased extension without the dot, or '' if none. */
function extOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** First non-empty path segment (the top-level dir), or '' for a bare filename. */
function firstDir(file: string): string {
  const parts = file.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

/**
 * Derive a clustering signature from a todo's touched files. The KEY groups events:
 * the dominant signal for an unrecognized framework is its file EXTENSIONS (e.g.
 * `.step`/`.parts`), so the key is the sorted unique extensions; with no extensions
 * (extensionless files) it falls back to `dir:<dirs>`.
 */
export function signatureForFiles(files: string[] | null | undefined): {
  key: string;
  exts: string[];
  dirs: string[];
} {
  const exts = new Set<string>();
  const dirs = new Set<string>();
  for (const f of files ?? []) {
    const e = extOf(f);
    if (e) exts.add(e);
    const d = firstDir(f);
    if (d) dirs.add(d);
  }
  const sortedExts = [...exts].sort();
  const sortedDirs = [...dirs].sort();
  const key = sortedExts.length > 0 ? sortedExts.join(',') : `dir:${sortedDirs.join(',')}`;
  return { key, exts: sortedExts, dirs: sortedDirs };
}

// ---------------------------------------------------------------------------
// Pack-coverage check (is this cluster ALREADY handled by a routing rule / pack?)
// ---------------------------------------------------------------------------

/**
 * True when an existing routing rule already maps these files to a concrete
 * (non-general) profile — the global PATH_RULES or the project manifest's own
 * pathRules. Such a cluster is NOT an opportunity: a pack/rule already covers it,
 * so general-routing was incidental, not a gap. (Re-checked at detect time because
 * a project may have added a manifest rule since the events were recorded.)
 */
export function hasMatchingPack(project: string, files: string[]): boolean {
  if (inferProfileType(files) !== 'default') return true;
  if (inferTypeFromManifest(project, files) != null) return true;
  return false;
}

// ---------------------------------------------------------------------------
// DETECT — accumulate
// ---------------------------------------------------------------------------

export interface RecordRoutingInput {
  todoId: string;
  files?: string[] | null;
  session?: string | null;
}

/**
 * Record one routed-to-`general` event. Idempotent per todo: re-recording the same
 * todoId REPLACES its prior signal, so a re-claimed/retried todo never inflates a
 * cluster's distinct-todo count. Events with no files are ignored (nothing to
 * cluster on) and return null. Best-effort: serialized per project.
 */
export function recordGeneralRouting(project: string, input: RecordRoutingInput): Promise<RoutingSignal | null> {
  return withLock(project, () => {
    const files = [...new Set((input.files ?? []).filter(Boolean))];
    if (!input.todoId || files.length === 0) return null;
    const { key } = signatureForFiles(files);
    const signal: RoutingSignal = {
      todoId: input.todoId,
      key,
      files,
      session: input.session ?? null,
      createdAt: new Date().toISOString(),
    };
    const file = readStore(project);
    const signals = file.signals.filter((s) => s.todoId !== input.todoId);
    signals.push(signal);
    writeStore(project, { ...file, signals });
    return signal;
  });
}

// ---------------------------------------------------------------------------
// DETECT — cluster + threshold
// ---------------------------------------------------------------------------

/**
 * Cluster the recorded signals by key and return the opportunities — clusters with
 * >= `threshold` DISTINCT todos that STILL have no matching pack. PURE (no
 * mutation, no dedup against prior emissions — use {@link pollNewOpportunities} for
 * the deduped signal). Sorted by cluster size, largest first.
 */
export function detectOpportunities(
  project: string,
  opts: { threshold?: number } = {},
): ProfileOpportunity[] {
  const threshold = opts.threshold ?? generalOveruseThreshold();
  const byKey = new Map<string, RoutingSignal[]>();
  for (const s of readStore(project).signals) {
    const arr = byKey.get(s.key) ?? [];
    arr.push(s);
    byKey.set(s.key, arr);
  }
  const out: ProfileOpportunity[] = [];
  for (const [key, signals] of byKey) {
    const todoIds = [...new Set(signals.map((s) => s.todoId))];
    if (todoIds.length < threshold) continue;
    const allFiles = signals.flatMap((s) => s.files);
    if (hasMatchingPack(project, allFiles)) continue;
    const { exts, dirs } = signatureForFiles(allFiles);
    out.push({
      key,
      todoIds,
      exts,
      dirs,
      sampleFiles: [...new Set(allFiles)].slice(0, 5),
    });
  }
  return out.sort((a, b) => b.todoIds.length - a.todoIds.length);
}

/**
 * Emit the profile-opportunity SIGNAL: the qualifying clusters NOT already emitted.
 * Marks each returned cluster's key as emitted so a subsequent poll never re-fires
 * the same cluster (the deduped-signal requirement). Returns the newly-emitted
 * opportunities (possibly empty). Serialized per project.
 */
export function pollNewOpportunities(
  project: string,
  opts: { threshold?: number } = {},
): Promise<ProfileOpportunity[]> {
  return withLock(project, () => {
    const file = readStore(project);
    const emitted = new Set(file.emitted);
    const fresh = detectOpportunities(project, opts).filter((o) => !emitted.has(o.key));
    if (fresh.length === 0) return [];
    for (const o of fresh) emitted.add(o.key);
    writeStore(project, { ...file, emitted: [...emitted] });
    return fresh;
  });
}

/** Test/ops seam: forget a cluster's emitted mark so it can fire again (e.g. after
 *  a proposal was rejected and the pattern recurs). No-op if not emitted. */
export function clearEmitted(project: string, key: string): Promise<void> {
  return withLock(project, () => {
    const file = readStore(project);
    if (!file.emitted.includes(key)) return;
    writeStore(project, { ...file, emitted: file.emitted.filter((k) => k !== key) });
  });
}

/** Read-only snapshot of recorded signals (newest last). For inspection/tests. */
export function listSignals(project: string): RoutingSignal[] {
  return readStore(project).signals;
}
