/**
 * Grok triage classifier for the Orchestrator `propose` level (Orch P2).
 *
 * Design: design-orch-p2-propose (post-Grok-consult shape) + design-unified-
 * orchestrator-daemon §4/§5/§11.
 *
 * SINGLE-SHOT, not a tool-loop: the daemon packs a read-only ground-truth bundle
 * for one open escalation and asks Grok to CLASSIFY it into a triage bucket. The
 * Grok consult (design §6) cut the tool-loop — because the server proof gate
 * re-validates the act at confirm-time, Grok's investigation depth only changes
 * WHICH suggestions appear, not correctness; a packed bundle is simpler + more
 * deterministic.
 *
 * SAFETY SIMPLIFICATION: Grok returns ONLY { bucket, confidence, rationale }. The
 * daemon derives verb + proof DETERMINISTICALLY (deriveAct) — Grok never
 * hand-formats a proof. Only `now-buildable` yields an actionable verb
 * (reset_todo + {kind:'dep-done'}); the proof gate re-derives deps-all-done from
 * the store at confirm. Every other bucket is classify-only (verb=null) — it just
 * routes the human's attention. override_accept automation is DEFERRED (open Q1).
 *
 * Pure/injectable: git/store/Grok are behind `TriageDeps` so it unit-tests with no
 * network or live repo (same seam style as runOrchestratorTick).
 */

import type { Escalation, SuggestedAction, TriageBucket } from './supervisor-store.ts';
import { getTodo } from './todo-store.ts';
import { listSupervisorAudit } from './supervisor-store.ts';
import { getConfig } from './config-service.ts';
import { execFileSync } from 'node:child_process';

const BUCKETS: TriageBucket[] = ['stale', 'verified-done', 'now-buildable', 'genuine-decision', 'needs-design'];

/** Minimal todo view the bundle exposes (read-only). */
export interface TriageTodoView {
  id: string;
  title: string;
  status: string;
  retryCount: number;
  acceptanceStatus: string | null;
  dependsOn: string[];
  type: string | null;
  targetProject: string | null;
  updatedAt: string;
}

/** Injectable seams. Defaults shell out / hit the store / call x.ai. */
export interface TriageDeps {
  getTodo?: (project: string, id: string) => TriageTodoView | null;
  /** Dep rows for a todo's dependsOn, in order. */
  getDeps?: (project: string, ids: string[]) => Array<{ id: string; status: string; acceptanceStatus: string | null }>;
  listRecentAudit?: (project: string, limit: number) => Array<{ kind: string; session: string; detail: string | null; ts: number }>;
  commitsBehindMaster?: (project: string) => number;
  /** Single-shot Grok call: returns the raw text reply. */
  callGrok?: (system: string, prompt: string) => Promise<string>;
}

/** The read-only ground-truth bundle packed for one escalation. Also stored on the
 *  suggestion as `bundleInputs` (provenance — detects a stale suggestion later). */
export interface TriageBundle {
  escalation: { id: string; kind: string; questionText: string; todoId: string | null };
  todo: TriageTodoView | null;
  deps: Array<{ id: string; status: string; acceptanceStatus: string | null }>;
  git: { commitsBehindMaster: number | null };
  recentAudit: Array<{ kind: string; session: string; detail: string | null; ts: number }>;
}

// ---------------------------------------------------------------------------
// Default (real) dep implementations
// ---------------------------------------------------------------------------

function realGetTodo(project: string, id: string): TriageTodoView | null {
  const t = getTodo(project, id);
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    retryCount: t.retryCount ?? 0,
    acceptanceStatus: t.acceptanceStatus ?? null,
    dependsOn: t.dependsOn ?? [],
    type: t.type ?? null,
    targetProject: t.targetProject ?? null,
    updatedAt: t.updatedAt,
  };
}

function realGetDeps(project: string, ids: string[]) {
  return ids.map((id) => {
    const d = getTodo(project, id);
    return { id, status: d?.status ?? 'unknown', acceptanceStatus: d?.acceptanceStatus ?? null };
  });
}

function realListRecentAudit(project: string, limit: number) {
  return listSupervisorAudit({ project, limit }).map((e) => ({
    kind: e.kind,
    session: e.session,
    detail: e.detail,
    ts: e.ts,
  }));
}

function realCommitsBehindMaster(project: string): number {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD..master'], { cwd: project, encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function realCallGrok(system: string, prompt: string): Promise<string> {
  const apiKey = getConfig('XAI_API_KEY');
  if (!apiKey) throw new Error('XAI_API_KEY is not set');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'grok-build-0.1',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Grok API error ${res.status}`);
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Bundle + prompt
// ---------------------------------------------------------------------------

export function packBundle(project: string, esc: Escalation, deps: TriageDeps = {}): TriageBundle {
  const getTodoFn = deps.getTodo ?? realGetTodo;
  const getDepsFn = deps.getDeps ?? realGetDeps;
  const listAuditFn = deps.listRecentAudit ?? realListRecentAudit;
  const behindFn = deps.commitsBehindMaster ?? realCommitsBehindMaster;

  const todo = esc.todoId ? getTodoFn(project, esc.todoId) : null;
  const depRows = todo ? getDepsFn(project, todo.dependsOn) : [];
  let commitsBehind: number | null = null;
  try {
    commitsBehind = behindFn(project);
  } catch {
    commitsBehind = null;
  }
  return {
    escalation: { id: esc.id, kind: esc.kind, questionText: esc.questionText, todoId: esc.todoId },
    todo,
    deps: depRows,
    git: { commitsBehindMaster: commitsBehind },
    recentAudit: listAuditFn(project, 8),
  };
}

const SYSTEM_PROMPT = `You are a triage classifier for a software work-orchestration daemon. An autonomous worker raised an ESCALATION (a blocker/question it could not resolve). Classify it into EXACTLY ONE bucket, reading ONLY the ground-truth bundle provided. Do not invent facts.

Buckets:
- "now-buildable": the escalation is unblocked NOW — every dependency the linked todo names is done/accepted in the store. The todo can simply be re-promoted. The server re-verifies deps-all-done before acting.
- "verified-done": the work appears already complete (the deliverable is present in-tree) but the todo/escalation is still open — the gate likely false-rejected it. If you can name the deliverable (a file path it created OR a unique symbol/identifier it added), include it as "artifact" so the server can re-verify presence AND that the tree compiles before override-accepting.
- "stale": the escalation no longer matters (superseded, abandoned, the worker is long gone).
- "genuine-decision": a real product/design A·B choice only a human should make.
- "needs-design": blocked on a missing design/spec; a human must land it.

Rules:
- Prefer the conservative bucket. When unsure between an actionable bucket (now-buildable / verified-done) and anything else, do NOT pick the actionable one.
- "now-buildable" and "verified-done" lead to an automatic act (the server re-derives the proof first); the rest just route a human's attention. A wrong actionable classification is the costliest error — require the bundle to actually support it (deps all done; or the deliverable clearly already produced).
- For "verified-done", include "artifact" only when the bundle gives you a concrete file path or unique symbol; otherwise omit it (the escalation will just route a human's attention).
- Respond with ONLY a JSON object, no prose, no code fence:
  {"bucket": "<one bucket>", "confidence": <0..1>, "rationale": "<one sentence>", "artifact": "<optional file path or symbol for verified-done>"}`;

function buildUserPrompt(bundle: TriageBundle): string {
  return `Ground-truth bundle (JSON):\n${JSON.stringify(bundle, null, 2)}\n\nClassify the escalation. Respond with only the JSON object.`;
}

// ---------------------------------------------------------------------------
// Parse + derive
// ---------------------------------------------------------------------------

interface GrokVerdict {
  bucket: TriageBucket;
  confidence: number;
  rationale: string;
  /** For verified-done: a file path or unique symbol naming the deliverable. */
  artifact?: string;
}

/** Parse Grok's reply into a verdict, tolerating a code fence / surrounding prose.
 *  Returns null on any malformation (caller fails open). */
export function parseVerdict(raw: string): GrokVerdict | null {
  if (!raw) return null;
  // Extract the first {...} block (Grok sometimes wraps in a fence or adds prose).
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const p = JSON.parse(match[0]);
    if (!BUCKETS.includes(p.bucket)) return null;
    const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0;
    const rationale = typeof p.rationale === 'string' ? p.rationale : '';
    const artifact = typeof p.artifact === 'string' && p.artifact.trim() ? p.artifact.trim() : undefined;
    return { bucket: p.bucket, confidence, rationale, artifact };
  } catch {
    return null;
  }
}

/** Heuristic: an artifact string is a file PATH (has a dot-extension or a slash)
 *  vs a code SYMBOL. Decides which override-clean field to populate (both are
 *  re-derived server-side: fileExists vs git grep). */
function isPathLike(artifact: string): boolean {
  return artifact.includes('/') || /\.[a-zA-Z0-9]+$/.test(artifact);
}

/**
 * Deterministically derive the verb + proof from the bucket. Grok NEVER formats a
 * proof — the daemon owns this map so the act is auditable + the gate re-derives.
 *  - now-buildable → reset_todo + {dep-done} (gate re-derives deps from the store).
 *  - verified-done + a named artifact → override_accept_todo + {override-clean}
 *    (gate re-derives artifact presence AND tsc-clean; no change-set needed).
 *  - everything else → classify-only (no verb).
 */
export function deriveAct(
  bucket: TriageBucket,
  artifact?: string,
): { verb: SuggestedAction['verb']; args: SuggestedAction['args'] } {
  if (bucket === 'now-buildable') {
    return { verb: 'reset_todo', args: { proof: { kind: 'dep-done' }, status: 'ready' } };
  }
  if (bucket === 'verified-done' && artifact) {
    const proof = isPathLike(artifact)
      ? { kind: 'override-clean', artifactPath: artifact }
      : { kind: 'override-clean', artifactSymbol: artifact };
    return { verb: 'override_accept_todo', args: { proof } };
  }
  return { verb: null, args: null };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/** Confidence below which a now-buildable suggestion is downgraded to classify-only
 *  (fail-open: we never propose an auto-act we're not confident about). */
export const NOW_BUILDABLE_MIN_CONFIDENCE = 0.7;

/** override_accept is the scary verb — hold its auto-proposal to a higher bar than
 *  reset_todo. Below this, verified-done downgrades to classify-only (human decides). */
export const OVERRIDE_MIN_CONFIDENCE = 0.85;

/** At level `drive` the daemon may AUTO-resolve (no human confirm) — held to an
 *  even higher confidence bar than `propose` proposals. Below this, the suggestion
 *  is still written for the human (propose behaviour), just not auto-applied. The
 *  proof gate re-validates every auto-act regardless, so this only gates WHICH
 *  suggestions the daemon attempts to apply unattended. */
export const AUTO_RESOLVE_MIN_CONFIDENCE = 0.9;

/**
 * Classify one escalation into a SuggestedAction (or null when nothing useful to
 * suggest). Single Grok call over a packed bundle. Fails OPEN on any error: a
 * thrown Grok call / malformed verdict returns null (no suggestion → the human sees
 * the plain escalation, unchanged).
 */
export async function classifyEscalation(
  project: string,
  esc: Escalation,
  deps: TriageDeps = {},
  now: number = Date.now(),
): Promise<SuggestedAction | null> {
  const callGrok = deps.callGrok ?? realCallGrok;
  const bundle = packBundle(project, esc, deps);

  let raw: string;
  try {
    raw = await callGrok(SYSTEM_PROMPT, buildUserPrompt(bundle));
  } catch {
    return null; // fail open — no suggestion
  }

  const verdict = parseVerdict(raw);
  if (!verdict) return null;

  let { verb, args } = deriveAct(verdict.bucket, verdict.artifact);
  // Confidence guard: a low-confidence auto-act is downgraded to classify-only so we
  // never propose an act on a shaky classification. override_accept (the scary verb)
  // is held to a higher bar than reset_todo.
  if (verb === 'reset_todo' && verdict.confidence < NOW_BUILDABLE_MIN_CONFIDENCE) {
    verb = null;
    args = null;
  }
  if (verb === 'override_accept_todo' && verdict.confidence < OVERRIDE_MIN_CONFIDENCE) {
    verb = null;
    args = null;
  }

  // For a classify-only verdict with nothing actionable AND no genuine routing value
  // (stale), still surface it — the rationale routes attention. We keep all buckets.
  return {
    bucket: verdict.bucket,
    verb,
    args,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    bundleInputs: {
      todoStatus: bundle.todo?.status ?? null,
      todoUpdatedAt: bundle.todo?.updatedAt ?? null,
      deps: bundle.deps,
      commitsBehindMaster: bundle.git.commitsBehindMaster,
    },
    generatedAt: now,
  };
}
