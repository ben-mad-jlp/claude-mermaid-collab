/**
 * prompt-injection — the SINGLE site that assembles the per-node advisory system-prompt
 * blocks appended (via NodeSpec.appendSystemPrompt) to a build node's system prompt.
 *
 * SKELETON leaf (a82db980): every payload seam is EMPTY, so composeInjectedContext returns
 * '' for all inputs and the wiring makes appendSystemPrompt undefined (prompt byte-identical
 * to today). Payloads A/B/C are LATER leaves — each fills one seam below by pushing a wrapped
 * block. Keep this the ONLY production file that emits the delimited block markers.
 */
import type { LeafNodeKind } from './leaf-executor';
import type { InjectionFlags } from './runtime-config';
import { getActiveConstraints, listDecisionRecords } from './decision-record-store';
import { readProjectDigest } from './project-digest';

/** Structural subset of ledger-stats LeafRunStats the retry payload needs. */
export interface PriorRunInput {
  terminal?: { reason?: string | null; gateReasons?: string[] } | null;
  reviewVerdict?: 'pass' | 'fail' | null;
  finalOutcome?: string | null;
}

export interface ComposeInjectedContextArgs {
  kind: LeafNodeKind;
  project: string;
  epicId?: string | null;
  flags: InjectionFlags;
  attempt?: number;
  priorRun?: PriorRunInput | null;
  /** Override for the cached-digest read (test seam). Defaults to readProjectDigest. */
  readDigest?: (project: string) => string | null;
}

/** Distinctive advisory marker — the source-guard test asserts it lives in exactly this file. */
const ADVISORY_SUFFIX = 'advisory — verify against the tree';

/** Node kinds that can benefit from active constraints. Blueprint included (mission-forge
 *  wiring): the PLAN author needs the locked constraints most — a plan drafted blind to a
 *  "X stays pre-land" rule wastes the whole downstream pipeline. */
const CONSTRAINTS_KINDS = new Set<LeafNodeKind>(['blueprint', 'implement', 'wimplement', 'fix', 'review']);

/** Node kinds eligible for retry-context payload B (prior-attempt fail info). */
const RETRY_KINDS = new Set<LeafNodeKind>(['blueprint', 'implement']);

/** Node kinds eligible for the project-digest payload A (v1 scope — NOT implement). */
const DIGEST_KINDS = new Set<LeafNodeKind>(['blueprint', 'research']);

/** Hard cap on retry block body (chars); ~500 tokens. */
const RETRY_BLOCK_CHAR_CAP = 2000;

/** Payload D scope: rejected design alternatives orient the PLAN author only. */
const REJECTED_ALTS_KINDS = new Set<LeafNodeKind>(['blueprint']);
/** Most-recent decision records considered for payload D. */
const REJECTED_ALTS_MAX_RECORDS = 8;
/** Hard cap on the payload D body (chars); ~500 tokens. */
const REJECTED_ALTS_CHAR_CAP = 2000;

/** Marker appended when retry body exceeds the char cap. */
const RETRY_TRUNCATION_MARKER = '…[truncated — see leaf ledger for full detail]';

/** Wrap one payload body in a clearly-delimited advisory block. Exported for the shape test. */
export function _wrapBlock(name: string, body: string): string {
  return `\n\n=== ${name} (${ADVISORY_SUFFIX}) ===\n${body}\n=== end ${name} ===`;
}

/** Join non-empty blocks; no blocks ⇒ ''. */
function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim().length > 0).join('');
}

/** Check if the prior run indicates failure. */
function priorRunFailed(pr: PriorRunInput): boolean {
  if (pr.reviewVerdict === 'fail') return true;
  if (pr.terminal?.reason && pr.terminal.reason.trim()) return true;
  const gateReasons = (pr.terminal?.gateReasons ?? []).filter((g) => g && g.trim());
  if (gateReasons.length > 0) return true;
  if (pr.finalOutcome && ['rejected', 'blocked'].includes(pr.finalOutcome)) return true;
  return false;
}

/** Cap the retry body to RETRY_BLOCK_CHAR_CAP, appending truncation marker if needed. */
function capRetryBody(body: string): string {
  if (body.length > RETRY_BLOCK_CHAR_CAP) {
    return body.slice(0, RETRY_BLOCK_CHAR_CAP) + '\n' + RETRY_TRUNCATION_MARKER;
  }
  return body;
}

/**
 * Assemble the injected system-prompt context for one node. Returns '' when no payload seam
 * contributes (always, in this leaf). Callers pass `composeInjectedContext(...) || undefined`
 * so an empty result leaves appendSystemPrompt undefined.
 */
export function composeInjectedContext(args: ComposeInjectedContextArgs): string {
  const blocks: string[] = [];
  // Payload B — serves prompt-injection retryContext criterion. Emit PREVIOUS ATTEMPT FAILED
  // block carrying the VERBATIM terminal fail strings (hard-capped at ~500 tokens).
  if (
    args.flags.retryContext &&
    RETRY_KINDS.has(args.kind) &&
    (args.attempt ?? 1) > 1 &&
    args.priorRun &&
    priorRunFailed(args.priorRun)
  ) {
    const pr = args.priorRun;
    const parts: string[] = [];
    if (pr.terminal?.reason && pr.terminal.reason.trim()) parts.push(`reason: ${pr.terminal.reason}`);
    if (pr.reviewVerdict) parts.push(`review verdict: ${pr.reviewVerdict}`);
    const gate = (pr.terminal?.gateReasons ?? []).filter((g) => g && g.trim());
    if (gate.length) parts.push(`gate reasons: ${gate.join('; ')}`);
    const body = capRetryBody(parts.join('\n'));
    if (body.trim().length > 0) blocks.push(_wrapBlock('PREVIOUS ATTEMPT FAILED', body));
  }
  // Payload C — serves prompt-injection activeConstraints criterion. Epic-scoped ∪
  // project-level active constraints as an advisory block (constraint text = `title`).
  if (args.flags.activeConstraints && CONSTRAINTS_KINDS.has(args.kind)) {
    const constraints = getActiveConstraints(args.project, args.epicId);
    if (constraints.length > 0) {
      const body = constraints.map((c) => `- ${c.id}: ${c.title}`).join('\n');
      blocks.push(_wrapBlock('ACTIVE CONSTRAINTS', body));
    }
  }
  // Payload D — REJECTED ALTERNATIVES (mission-forge wiring). Design decisions carry the
  // alternatives a skeptical consult killed; surfacing them to the PLAN author stops builders
  // re-proposing designs already rejected (the automated half of the conductor's "name the
  // plausible-looking wrong fix" rule). Same flag lever as payload C — one decision-context
  // switch. Self-gating: no active decision records with alternatives ⇒ zero bytes.
  if (args.flags.activeConstraints && REJECTED_ALTS_KINDS.has(args.kind)) {
    let records: ReturnType<typeof listDecisionRecords> = [];
    try {
      records = listDecisionRecords(args.project, { kind: 'decision', status: 'active' });
    } catch {
      // advisory payload — a store read failure must never fail a node spawn
    }
    const withAlts = records
      .filter((r) => (r.alternatives ?? []).length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, REJECTED_ALTS_MAX_RECORDS);
    if (withAlts.length > 0) {
      let body = withAlts
        .map((r) => `- ${r.title}\n  rejected: ${(r.alternatives ?? []).join(' | ')}`)
        .join('\n');
      if (body.length > REJECTED_ALTS_CHAR_CAP) {
        body = body.slice(0, REJECTED_ALTS_CHAR_CAP) + '\n' + RETRY_TRUNCATION_MARKER;
      }
      blocks.push(_wrapBlock('PRIOR DESIGN DECISIONS — REJECTED ALTERNATIVES (do not re-propose)', body));
    }
  }
  // Payload A — serves the projectDigest criterion. When the digest flag is ON and the kind is
  // orientation-eligible (blueprint/research, NOT implement — v1 scope), read the CACHED digest
  // (.collab/project-digest.md; never regenerate here) and emit it as an advisory block.
  if (args.flags.digest && DIGEST_KINDS.has(args.kind)) {
    const read = args.readDigest ?? readProjectDigest;
    const digest = read(args.project);
    if (digest && digest.trim().length > 0) {
      blocks.push(_wrapBlock('PROJECT DIGEST', digest));
    }
  }
  return joinBlocks(blocks);
}
