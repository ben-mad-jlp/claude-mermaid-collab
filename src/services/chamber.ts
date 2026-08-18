/**
 * chamber.ts — Four-phase generative protocol for campaign closure deliberation.
 *
 * The chamber deliberates whether a campaign should close by having five generals advise
 * independently on distinct dimensions. The president then rules on closure.
 *
 * Phases:
 * 1. Propose: Each general authors a candidate for closure
 * 2. Veto: Each general may veto one candidate (all generals must propose first)
 * 3. Wargame: Vetoed candidates are filtered out, remaining ones are challenged
 * 4. Decide: President makes the final ruling with refined guidance
 */

import type { JudgmentLLM } from './judgment-llm.ts';
import {
  buildGeneralSystemPrompt,
  buildPresidentSystemPrompt,
  CHAMBER_GENERALS,
} from './chamber-constitution.ts';
import {
  recordChamberTranscript,
  recordChamberDecision,
  listChamberTranscript,
  type ChamberPhase,
  type ChamberTranscriptInput,
  type ChamberDecisionInput,
  type ChamberDecisionRecord,
} from './campaign-store.ts';

// Re-export the roster as the single source of truth.
export { CHAMBER_GENERALS };

/**
 * A proposed closure candidate presented by a general.
 */
export interface ChamberCandidate {
  general: string;
  goal: string;
  rationale: string;
}

/**
 * A veto against a candidate by a general.
 */
export interface ChamberVeto {
  general: string;
  targetIndex: number;
  dissent: string;
}

/**
 * A candidate with critique collected during the wargame phase.
 */
export interface ChamberWargamed {
  candidate: ChamberCandidate;
  critiques: string[];
}

/**
 * Factory function for creating a JudgmentLLM for a specific role and phase.
 */
export type ChamberLLMFactory = (role: string, phase: ChamberPhase) => JudgmentLLM;

/**
 * Arguments passed to chamber phase functions.
 */
export interface ChamberArgs {
  campaignId: string;
  sessionId: string;
  decidedAtSha: string;
  llm: JudgmentLLM | ChamberLLMFactory;
  model?: string | null;
  forgeInput?: any;
}

/**
 * Dependency injection for chamber operations (e.g., mission forging).
 */
export interface ChamberDeps {
  forgeMission: (project: string, input: any) => Promise<any>;
}

/**
 * Resolve the LLM to use for a given role and phase.
 * If llm has a complete method, return it as-is. Otherwise, call it as a factory.
 */
function resolveLLM(llm: JudgmentLLM | ChamberLLMFactory, role: string, phase: ChamberPhase): JudgmentLLM {
  if ('complete' in llm && typeof llm.complete === 'function') {
    return llm as JudgmentLLM;
  }
  const factory = llm as ChamberLLMFactory;
  return factory(role, phase);
}

/**
 * Resolve the president's chosen candidate from the parsed reply.
 *
 * Rules, all returning `null` (⇒ inaction):
 * - `parsed` is not a non-null object;
 * - `chosenIndex` present but not an integer in `[0, wargamed.length)`;
 * - `chosenCandidate` (or `chosen`) present as a string that does not `===` the `goal` of any
 *   entry in `wargamed` — even when `chosenIndex` is in range (the two must agree);
 * - neither `chosenIndex` nor a matching `chosenCandidate` present.
 *
 * When only a matching `chosenCandidate` string is given, resolve its index from `wargamed`.
 */
export function resolvePresidentChoice(
  parsed: any,
  wargamed: ChamberWargamed[],
): { candidate: ChamberCandidate; index: number } | null {
  // parsed must be a non-null object
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const chosenIndex = parsed.chosenIndex;
  const chosenCandidate = parsed.chosenCandidate || parsed.chosen;

  let resolvedIndex: number | null = null;
  let resolvedCandidate: ChamberCandidate | null = null;

  // If chosenIndex is provided, validate it
  if (typeof chosenIndex === 'number') {
    if (chosenIndex >= 0 && chosenIndex < wargamed.length) {
      resolvedIndex = chosenIndex;
      resolvedCandidate = wargamed[chosenIndex].candidate;
    } else {
      // chosenIndex out of range
      return null;
    }
  }

  // If chosenCandidate is provided, find it in wargamed
  if (typeof chosenCandidate === 'string') {
    const found = wargamed.find((w) => w.candidate.goal === chosenCandidate);
    if (!found) {
      // String doesn't match any candidate goal
      return null;
    }
    const candidateIndex = wargamed.indexOf(found);
    if (resolvedIndex !== null && resolvedIndex !== candidateIndex) {
      // chosenIndex and chosenCandidate disagree
      return null;
    }
    resolvedIndex = candidateIndex;
    resolvedCandidate = found.candidate;
  }

  // Neither chosenIndex nor matching chosenCandidate present
  if (resolvedIndex === null || !resolvedCandidate) {
    return null;
  }

  return { candidate: resolvedCandidate, index: resolvedIndex };
}

/**
 * Propose phase: Each general author a candidate for closure.
 *
 * Iterates through CHAMBER_GENERALS in order. Each general is called once via LLM.complete.
 * The reply is expected to be a JSON object with {"goal": string, "rationale": string}.
 * A general whose reply is empty or unparseable is dropped from the returned list but
 * still gets a transcript row written. Returns the list of candidates (may be shorter
 * than the roster if some generals failed).
 */
export async function propose(
  project: string,
  args: ChamberArgs,
): Promise<ChamberCandidate[]> {
  const candidates: ChamberCandidate[] = [];

  for (const general of CHAMBER_GENERALS) {
    const llm = resolveLLM(args.llm, general, 'propose');

    // Build the prompt with the reply contract for the propose phase.
    const { system: baseSystem, user } = buildGeneralSystemPrompt(general, {
      goal: 'Campaign closure readiness',
    });

    const proposeContract = `Respond with a single JSON object:
{"goal":string,"rationale":string}

- goal is the proposed closure candidate (a specific objective to achieve or condition to verify).
- rationale is the reasoning for proposing this candidate.`;

    const system = [baseSystem, proposeContract].join('\n\n');

    let candidate: ChamberCandidate | null = null;

    try {
      const reply = await llm.complete(system, user);

      if (reply && reply.trim()) {
        const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.goal && typeof parsed.goal === 'string' && parsed.rationale) {
            candidate = {
              general,
              goal: parsed.goal,
              rationale: parsed.rationale,
            };
            candidates.push(candidate);
          }
        }
      }
    } catch {
      // Fall through: general failed, but continue with next
    }

    // Always write a transcript row, even if the general failed or was dropped.
    recordChamberTranscript(project, {
      campaignId: args.campaignId,
      sessionId: args.sessionId,
      phase: 'propose',
      role: general,
      model: args.model ?? null,
      content: candidate
        ? JSON.stringify({ goal: candidate.goal, rationale: candidate.rationale })
        : '(failed)',
    });
  }

  return candidates;
}

/**
 * Veto phase: Each general may veto one candidate from the slate.
 *
 * GUARD: Throws if the full roster has not proposed (checked against the length of
 * the candidates list passed in). This guard runs BEFORE any complete call or transcript write.
 *
 * Iterates through CHAMBER_GENERALS. Each general is given the numbered candidate slate
 * and votes on which (if any) to veto. The reply is expected to be a JSON object with
 * {"targetIndex": int|null, "dissent": string|null}.
 *
 * Returns the list of vetoes (may be shorter than the roster if some generals failed).
 * Dissent strings are stored EXACTLY as authored (no trim, no re-wording).
 */
export async function veto(
  project: string,
  args: ChamberArgs,
  candidates: ChamberCandidate[],
): Promise<ChamberVeto[]> {
  // GUARD: Ensure all generals proposed first.
  if (candidates.length < CHAMBER_GENERALS.length) {
    throw new Error(
      `chamber: veto before every general proposed (expected ${CHAMBER_GENERALS.length}, got ${candidates.length})`,
    );
  }

  const vetoes: ChamberVeto[] = [];

  // Build the candidate slate for the prompt.
  const candidateSlate = candidates
    .map((c, i) => `${i}: ${c.goal} (proposed by ${c.general})`)
    .join('\n');

  for (const general of CHAMBER_GENERALS) {
    const llm = resolveLLM(args.llm, general, 'veto');

    const { system: baseSystem, user: baseUser } = buildGeneralSystemPrompt(general, {
      goal: 'Campaign closure readiness',
    });

    const vetoContract = `Respond with a single JSON object:
{"targetIndex":int|null,"dissent":string|null}

- targetIndex may be null (no veto) or an integer (index of the candidate to veto, 0-based).
- dissent may be null (no dissent) or a string (your objection to the candidate you are vetoing).`;

    const system = [baseSystem, vetoContract].join('\n\n');

    const user = `${baseUser}

Candidates for closure (indexed 0-${candidates.length - 1}):
${candidateSlate}

You may veto one candidate by index and provide your dissent, or pass with null values.`;

    let veto: ChamberVeto | null = null;

    try {
      const reply = await llm.complete(system, user);

      if (reply && reply.trim()) {
        const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const targetIndex = parsed.targetIndex;
          const dissent = parsed.dissent;

          // Only record a veto if targetIndex is a valid number.
          if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < candidates.length) {
            veto = {
              general,
              targetIndex,
              dissent: dissent || '',
            };
            vetoes.push(veto);
          }
        }
      }
    } catch {
      // Fall through: general failed to veto, continue with next
    }

    // Always write a transcript row.
    recordChamberTranscript(project, {
      campaignId: args.campaignId,
      sessionId: args.sessionId,
      phase: 'veto',
      role: general,
      model: args.model ?? null,
      content: veto
        ? JSON.stringify({ targetIndex: veto.targetIndex, dissent: veto.dissent })
        : '(no veto)',
    });
  }

  return vetoes;
}

/**
 * Wargame phase: Challenge the surviving candidates with critique.
 *
 * Filters out every candidate whose index appears in the vetoes array BEFORE issuing
 * any wargame call. Surviving candidates are each challenged via LLM. The reply is
 * expected to be a JSON object with {"critique": string}.
 *
 * Returns one ChamberWargamed entry per surviving candidate.
 */
export async function wargame(
  project: string,
  args: ChamberArgs,
  candidates: ChamberCandidate[],
  vetoes: ChamberVeto[],
): Promise<ChamberWargamed[]> {
  // Filter out vetoed candidates by index.
  const vetoedIndices = new Set(vetoes.map((v) => v.targetIndex));
  const survivingCandidates = candidates.filter((_, i) => !vetoedIndices.has(i));

  const wargamed: ChamberWargamed[] = [];

  for (let i = 0; i < survivingCandidates.length; i++) {
    const candidate = survivingCandidates[i];

    // Rotate through generals to challenge each candidate from a different perspective.
    const wargamerGeneral = CHAMBER_GENERALS[i % CHAMBER_GENERALS.length];
    const llm = resolveLLM(args.llm, wargamerGeneral, 'wargame');

    // Build the prompt from the constitution using the wargamer general.
    const { system: baseSystem, user: baseUser } = buildGeneralSystemPrompt(wargamerGeneral, {
      goal: 'Campaign closure readiness',
    });

    const wargameContract = `Respond with a single JSON object:
{"critique":string}

- critique is a potential weakness or concern with the proposed candidate, or confirmation that it is sound.`;

    const system = [baseSystem, wargameContract].join('\n\n');

    const user = `${baseUser}

Candidate: ${candidate.goal}

Proposed by: ${candidate.general}
Rationale: ${candidate.rationale}

Examine this candidate critically. What is the strongest concern or weakness? Or is it sound?`;

    const critiques: string[] = [];

    try {
      const reply = await llm.complete(system, user);

      if (reply && reply.trim()) {
        const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.critique && typeof parsed.critique === 'string') {
            critiques.push(parsed.critique);
          }
        }
      }
    } catch {
      // Fall through: wargame failed for this candidate, continue with next
    }

    wargamed.push({
      candidate,
      critiques,
    });

    // Write a wargame transcript row.
    recordChamberTranscript(project, {
      campaignId: args.campaignId,
      sessionId: args.sessionId,
      phase: 'wargame',
      role: wargamerGeneral,
      model: args.model ?? null,
      content: critiques.length > 0 ? JSON.stringify({ critique: critiques.join('; ') }) : '(no critique)',
    });
  }

  return wargamed;
}

/**
 * Decide phase: President rules on campaign closure.
 *
 * Calls the president via LLM to render a final ruling. The reply is expected to be
 * a JSON object with:
 * {"chosenIndex": int, "dissentIndex": int|null, "guidance": string, "reasoning": string}
 *
 * The decision is persisted exactly once via recordChamberDecision, carrying the chosen
 * candidate's goal, the strongest dissent verbatim from the veto/wargame phase, and the
 * refining guidance from the president.
 *
 * Failure discipline: If the president reply is unparseable or out-of-range, the outcome
 * is set to 'inaction' and chosenCandidate/strongestDissent/refiningGuidance are set to null.
 * The failure reason is folded into the persisted decide transcript row's content as
 * {"outcome":"inaction","reason":"..."}.
 *
 * Returns the recorded decision.
 */
export async function decide(
  project: string,
  args: ChamberArgs,
  wargamed: ChamberWargamed[],
  dissents: ChamberVeto[],
): Promise<ChamberDecisionRecord> {
  const llm = resolveLLM(args.llm, 'president', 'decide');

  // Build the president prompt.
  const { system: baseSystem, user: baseUser } = buildPresidentSystemPrompt({
    goal: 'Campaign closure readiness',
  });

  const decideContract = `Respond with a single JSON object:
{"chosenIndex":int,"dissentIndex":int|null,"guidance":string,"reasoning":string}

- chosenIndex is the index of your chosen candidate (0-based, must be valid).
- dissentIndex is the index of the strongest dissent to acknowledge, or null.
- guidance is your refined direction based on the chosen candidate.
- reasoning is your ruling explanation.`;

  const system = [baseSystem, decideContract].join('\n\n');

  // Build the candidate slate for the president.
  const candidateSlate = wargamed
    .map((w, i) => `${i}: ${w.candidate.goal} (proposed by ${w.candidate.general})`)
    .join('\n');

  const dissentList = dissents.map((d, i) => `${i}: ${d.dissent} (by ${d.general})`).join('\n');

  const user = `${baseUser}

Candidates for closure (indexed 0-${wargamed.length - 1}):
${candidateSlate}

Dissents recorded (indexed 0-${dissents.length - 1}):
${dissentList}

You are the president. Choose a candidate to close the campaign, acknowledge the strongest dissent, and provide refined guidance.`;

  let outcome: 'decision' | 'inaction' = 'inaction';
  let chosenCandidate: string | null = null;
  let strongestDissent: string | null = null;
  let refiningGuidance: string | null = null;
  let decideContent = JSON.stringify({ outcome: 'inaction', reason: 'empty reply' });
  let presidentFailure: string | null = null;

  try {
    const reply = await llm.complete(system, user);

    if (!reply || !reply.trim()) {
      presidentFailure = 'empty reply';
      decideContent = JSON.stringify({ outcome: 'inaction', reason: presidentFailure });
    } else {
      const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
      if (!jsonMatch) {
        presidentFailure = 'unparseable JSON';
        decideContent = JSON.stringify({ outcome: 'inaction', reason: presidentFailure });
      } else {
        let parsed: any;
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          presidentFailure = 'unparseable JSON';
          decideContent = JSON.stringify({ outcome: 'inaction', reason: presidentFailure });
        }

        if (parsed && !presidentFailure) {
          const resolved = resolvePresidentChoice(parsed, wargamed);
          if (!resolved) {
            presidentFailure = 'chosen candidate not among surviving candidates';
            decideContent = JSON.stringify({ outcome: 'inaction', reason: presidentFailure });
          } else {
            const dissentIndex = parsed.dissentIndex;
            const guidance = parsed.guidance;

            outcome = 'decision';
            chosenCandidate = resolved.candidate.goal;

            // Resolve strongest dissent by reference.
            if (typeof dissentIndex === 'number' && dissentIndex >= 0 && dissentIndex < dissents.length) {
              strongestDissent = dissents[dissentIndex].dissent;
            } else if (dissents.length > 0) {
              // Find the longest recorded dissent string.
              strongestDissent = dissents.reduce((longest, current) =>
                current.dissent.length > longest.dissent.length ? current : longest,
              ).dissent;
            }

            refiningGuidance = guidance || null;
            decideContent = JSON.stringify({
              chosenIndex: resolved.index,
              dissentIndex,
              guidance,
              reasoning: parsed.reasoning || '',
            });
          }
        }
      }
    }
  } catch (err) {
    // Fall through: president threw, outcome stays 'inaction'
    presidentFailure = `threw: ${err instanceof Error ? err.message : String(err)}`;
    decideContent = JSON.stringify({ outcome: 'inaction', reason: presidentFailure });
  }

  // Persist the decision with the decide transcript in the same transactional call.
  const decision = recordChamberDecision(project, {
    campaignId: args.campaignId,
    sessionId: args.sessionId,
    outcome,
    chosenCandidate,
    strongestDissent,
    refiningGuidance,
    decidedAtSha: args.decidedAtSha,
    transcript: [
      {
        campaignId: args.campaignId,
        sessionId: args.sessionId,
        phase: 'decide',
        role: 'president',
        model: args.model ?? null,
        content: decideContent,
      },
    ],
  });

  return decision;
}

/**
 * Assert that chamber transcript rows have been recorded before forge is invoked.
 * Throws if the transcript for this session is empty, ensuring that all phase
 * records are persisted before any mission forging begins.
 */
export function assertTranscriptRecordedBeforeForge(project: string, args: ChamberArgs): void {
  const transcript = listChamberTranscript(project, args.campaignId, args.sessionId);
  if (transcript.length === 0) {
    throw new Error('chamber: transcript not recorded before forge');
  }
}

/**
 * Orchestrate the complete chamber protocol: propose → veto → wargame → decide → optionally forge.
 *
 * All four phases run strictly sequentially. The decision is committed before
 * deps.forgeMission is called, and forgeMission is only called when outcome === 'decision'.
 *
 * Failure discipline: Every complete/JSON.parse error is caught and the run continues,
 * degrading that role's contribution. A run with nothing to choose ends as an 'inaction'
 * decision — it never throws.
 *
 * Returns an object carrying the entire deliberation result and the forged mission (if any).
 */
export async function runChamber(
  project: string,
  args: ChamberArgs,
  deps: ChamberDeps,
): Promise<{
  candidates: ChamberCandidate[];
  vetoes: ChamberVeto[];
  wargamed: ChamberWargamed[];
  decision: ChamberDecisionRecord;
  forged: any | null;
}> {
  // Phase 1: Propose.
  const candidates = await propose(project, args);

  // Phase 2: Veto (may throw if propose phase incomplete, but only on full roster check).
  let vetoes: ChamberVeto[] = [];
  try {
    vetoes = await veto(project, args, candidates);
  } catch {
    // Veto guard failure: guards are defensive and should not fail in normal operation.
    // Treat as a phase failure and continue.
  }

  // Phase 3: Wargame.
  const wargamed = await wargame(project, args, candidates, vetoes);

  // Phase 4: Decide (persists the decision row).
  const decision = await decide(project, args, wargamed, vetoes);

  // Forge only if the decision is 'decision' and we have a forgeInput.
  let forged: any = null;
  if (decision.outcome === 'decision' && args.forgeInput) {
    try {
      // Guard: transcript must be recorded before any forge attempt.
      assertTranscriptRecordedBeforeForge(project, args);
      forged = await deps.forgeMission(project, args.forgeInput);
    } catch {
      // Forge failure: logged but does not fail the run (the decision is already persisted).
    }
  }

  return { candidates, vetoes, wargamed, decision, forged };
}
