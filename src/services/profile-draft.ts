/**
 * Profile L4c — DRAFT: the ephemeral pack-candidate proposer (fd052733, stage 3).
 *
 * L4a DETECT emits a {@link ProfileOpportunity} signal ("a domain is leaning on the
 * `general` pool"). This module turns that signal into a concrete PROPOSAL: it
 * gathers the evidence (the general-routed todos in the cluster, the friction notes
 * those todos accrued, the existing tech-pack library) and asks an ephemeral
 * proposer AGENT to draft a structured pack-candidate — either ADOPT an existing
 * tech-pack when one already fits, or CREATE a new reusable pack when an
 * unrecognized framework keeps recurring (grow the LIBRARY, not a one-off
 * per-project type — decision e8fddf63).
 *
 * The output is a *candidate object only* — it is NOT persisted here. L4d APPROVE
 * is the human gate that decides whether to write a CREATE candidate into the L4b
 * store ({@link ./config/tech-packs}.registerPack) or to attach an ADOPT candidate
 * to the project manifest. This module deliberately stops at "well-formed proposal".
 *
 * The agent is reached through an injectable {@link ProposerAgentRunner} seam so the
 * pipeline is testable without spawning a real Claude process (the acceptance: "mock
 * the agent"). The default runner is left unset — callers (the L4 orchestrator) wire
 * a concrete runner; unit tests inject a stub.
 */
import type { TechPack } from '../config/tech-packs';
import { listPacks } from '../config/tech-packs';
import type { ProfileOpportunity } from './profile-opportunity';
import type { FrictionNote } from './friction-store';
import { listFriction } from './friction-store';

/** kebab-case id (mirrors the L4b store's own id rule). */
const PACK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A drafted pack proposal. Discriminated on `kind`:
 *  - `adopt`  — an existing library pack (by id) already covers this cluster; the
 *               project should just DECLARE it. No new pack body is created.
 *  - `create` — no existing pack fits; propose a NEW reusable pack body to grow the
 *               shared library.
 * Either way the candidate is advisory and not yet persisted.
 */
export type PackCandidate =
  | { kind: 'adopt'; packId: string; rationale: string }
  | { kind: 'create'; pack: TechPack; rationale: string };

/** The evidence bundle handed to the proposer agent (and surfaced on the L4d card). */
export interface DraftEvidence {
  /** The DETECT signal this draft responds to. */
  opportunity: ProfileOpportunity;
  /** Friction notes accrued by the cluster's todos (orchestration + domain). */
  frictionNotes: FrictionNote[];
  /** The current tech-pack library (seed + stored) the agent may ADOPT from. */
  existingPacks: TechPack[];
}

/**
 * The agent seam. Given a built prompt + the structured evidence, return the
 * agent's RAW textual reply (expected to contain a JSON pack-candidate). Injected so
 * the draft pipeline is unit-testable without a live agent.
 */
export type ProposerAgentRunner = (args: { prompt: string; evidence: DraftEvidence }) => Promise<string>;

export interface DraftOptions {
  /** The proposer agent runner (required — no live default in this substrate). */
  runAgent: ProposerAgentRunner;
}

/**
 * Gather the evidence for a draft: the opportunity plus the friction notes for every
 * todo in the cluster and the current pack library. Pure read — no mutation. The
 * cluster's friction is the strongest ADOPT-vs-CREATE signal: domain-layer friction
 * on an unrecognized framework argues for CREATE; little/orchestration-only friction
 * on files an existing pack covers argues for ADOPT.
 */
export function gatherEvidence(project: string, opportunity: ProfileOpportunity): DraftEvidence {
  const frictionNotes = opportunity.todoIds.flatMap((todoId) => listFriction(project, { todoId }));
  return { opportunity, frictionNotes, existingPacks: listPacks() };
}

/**
 * Build the proposer prompt from the evidence. Instructs the agent to emit EXACTLY
 * one JSON pack-candidate (ADOPT an existing id, or CREATE a new pack) and nothing
 * else. Kept deterministic so tests can assert it carries the evidence.
 */
export function buildProposerPrompt(evidence: DraftEvidence): string {
  const { opportunity: o, frictionNotes, existingPacks } = evidence;
  const packsList = existingPacks.map((p) => `- ${p.id}: ${p.description}`).join('\n') || '(none)';
  const friction = frictionNotes.length
    ? frictionNotes.map((f) => `- [${f.layer}/${f.retryReason}] todo ${f.todoId}${f.detail ? `: ${f.detail}` : ''}`).join('\n')
    : '(no friction recorded)';
  return [
    'You are the Profile DRAFT proposer (L4c). A cluster of work has been leaning on the',
    'general agent pool, which signals a domain that may want its own tech-pack.',
    '',
    `Cluster signature: ${o.key}`,
    `Distinct todos: ${o.todoIds.length}`,
    `File extensions: ${o.exts.join(', ') || '(none)'}`,
    `Top-level dirs: ${o.dirs.join(', ') || '(none)'}`,
    `Sample files:\n${o.sampleFiles.map((f) => `  ${f}`).join('\n') || '  (none)'}`,
    '',
    'Friction observed on these todos:',
    friction,
    '',
    'Existing tech-pack library (you MAY adopt one of these):',
    packsList,
    '',
    'Decide ONE of:',
    '- ADOPT: an existing pack above already covers this domain. The project should',
    '  just declare it.',
    '- CREATE: no existing pack fits and this framework recurs — propose a NEW reusable',
    '  pack (kebab-case id, description, contextPrompt domain fragment, allowedTools).',
    '',
    'Reply with ONLY a JSON object, no prose:',
    '  {"kind":"adopt","packId":"<existing-id>","rationale":"..."}',
    '  {"kind":"create","pack":{"id":"<kebab-id>","description":"...","contextPrompt":"...","allowedTools":"..."},"rationale":"..."}',
  ].join('\n');
}

/** Pull the first JSON object out of an agent reply (tolerates code fences / stray
 *  prose around it). Returns the parsed value or throws. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('proposer reply contained no JSON object');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Validate an agent reply into a well-formed {@link PackCandidate}. Throws on a
 * malformed candidate — the whole point of the DRAFT stage is that L4d APPROVE
 * receives a STRUCTURED proposal, never raw model text.
 *
 * - ADOPT: `packId` must resolve against the known library ids.
 * - CREATE: `pack` must be a complete TechPack with a kebab-case id that does NOT
 *   already exist (a CREATE that collides with a known id should have been an ADOPT).
 */
export function parsePackCandidate(raw: string, knownPackIds: readonly string[]): PackCandidate {
  const obj = extractJson(raw) as Record<string, unknown>;
  const known = new Set(knownPackIds);
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
  if (!rationale) throw new Error('pack-candidate: rationale is required');

  if (obj.kind === 'adopt') {
    const packId = typeof obj.packId === 'string' ? obj.packId.trim() : '';
    if (!packId) throw new Error('adopt candidate: packId is required');
    if (!known.has(packId)) throw new Error(`adopt candidate: unknown packId "${packId}"`);
    return { kind: 'adopt', packId, rationale };
  }

  if (obj.kind === 'create') {
    const pack = obj.pack as Record<string, unknown> | undefined;
    if (!pack || typeof pack !== 'object') throw new Error('create candidate: pack object is required');
    const id = typeof pack.id === 'string' ? pack.id.trim() : '';
    if (!PACK_ID.test(id)) throw new Error(`create candidate: id must be kebab-case (got "${String(pack.id)}")`);
    if (known.has(id)) throw new Error(`create candidate: id "${id}" already exists — should be an adopt`);
    if (typeof pack.description !== 'string' || !pack.description.trim()) {
      throw new Error('create candidate: description is required');
    }
    if (typeof pack.contextPrompt !== 'string' || !pack.contextPrompt.trim()) {
      throw new Error('create candidate: contextPrompt is required');
    }
    if (typeof pack.allowedTools !== 'string') {
      throw new Error('create candidate: allowedTools must be a string');
    }
    const clean: TechPack = {
      id,
      description: pack.description.trim(),
      contextPrompt: pack.contextPrompt,
      allowedTools: pack.allowedTools,
      ...(typeof pack.model === 'string' && pack.model ? { model: pack.model } : {}),
    };
    return { kind: 'create', pack: clean, rationale };
  }

  throw new Error(`pack-candidate: kind must be "adopt" or "create" (got ${String(obj.kind)})`);
}

/**
 * DRAFT a pack-candidate for one opportunity: gather evidence → build the prompt →
 * run the (injected) proposer agent → validate its reply into a structured ADOPT|
 * CREATE candidate. Returns the candidate WITHOUT persisting it (L4d owns adoption).
 */
export async function draftPackCandidate(
  project: string,
  opportunity: ProfileOpportunity,
  opts: DraftOptions,
): Promise<PackCandidate> {
  const evidence = gatherEvidence(project, opportunity);
  const prompt = buildProposerPrompt(evidence);
  const raw = await opts.runAgent({ prompt, evidence });
  return parsePackCandidate(raw, evidence.existingPacks.map((p) => p.id));
}
