/**
 * Profile L4d — APPROVE: the human gate that turns an L4c pack-candidate into a
 * persisted, cross-project tech-pack (fd052733, stage 4; deps L4c DRAFT + L4b
 * OWN-substrate).
 *
 * L4c {@link draftPackCandidate} produces a structured {@link PackCandidate}
 * (ADOPT an existing pack, or CREATE a new one) — advisory, not persisted. L4d
 * surfaces that candidate to a HUMAN as a structured Escalation.ui decision card
 * (the BR-4 closed catalog: a heading + the candidate's evidence + approve/reject
 * buttons) and, on the human's answer, COMMITS or DROPS it. This is a true product
 * decision (grow the shared library) — it is routed to a human and never resolved
 * automatically.
 *
 *   - APPROVE + CREATE → {@link registerPack} persists the new pack into the L4b
 *     writable store, so every project's resolver (resolveProfile/resolveTechPacks)
 *     sees it without a code change.
 *   - APPROVE + ADOPT  → {@link addManifestPack} declares the existing pack id in
 *     THIS project's manifest (the pack body already lives in the library).
 *   - REJECT (either kind) → drop; nothing is written.
 *
 * The card BUILDER is pure and deterministic (so it is unit-testable and so the
 * server's {@link validateUiSpec} accepts it — closed catalog, ≤40 elements, a
 * terminal action present); APPLY is the only side-effecting half.
 */
import type { TechPack } from '../config/tech-packs';
import { registerPack } from '../config/tech-packs';
import { addManifestPack } from '../config/project-manifest';
import type { JsonRenderSpec, UiElement } from './escalation-ui-schema';
import type { PackCandidate } from './profile-draft';

/** The two terminal answers on the L4d card. Exposed as constants so the card's
 *  OptionButton ids and the apply-step decision can never drift apart. */
export const APPROVE_OPTION = 'approve';
export const REJECT_OPTION = 'reject';

/** A human's answer to the approval card — exactly the two OptionButton ids. */
export type ApprovalDecision = typeof APPROVE_OPTION | typeof REJECT_OPTION;

/** The outcome of applying a decision to a candidate. `applied` is true only when
 *  the approve path actually wrote something (register or manifest-declare). */
export type ApprovalResult =
  | { decision: typeof REJECT_OPTION; applied: false }
  | { decision: typeof APPROVE_OPTION; applied: true; kind: 'create'; pack: TechPack }
  | { decision: typeof APPROVE_OPTION; applied: true; kind: 'adopt'; packId: string; packs: string[] };

/**
 * Build the structured Escalation.ui decision card for a pack-candidate. Returns a
 * {@link JsonRenderSpec} over the closed BR-4 catalog with a terminal action
 * (approve/reject OptionButtons), so it survives the server's `validateUiSpec`
 * rather than being silently dropped. The card carries the candidate's EVIDENCE
 * (a CREATE shows the proposed pack body as a diff against "nothing"; an ADOPT
 * names the existing pack being declared) so the human decides on the substance,
 * not just a label.
 */
export function buildApprovalCard(candidate: PackCandidate): JsonRenderSpec {
  const elements: UiElement[] = [];

  if (candidate.kind === 'create') {
    const { pack, rationale } = candidate;
    elements.push(
      { type: 'Heading', text: `Create new tech-pack: ${pack.id}`, level: 2 },
      { type: 'Text', text: rationale },
      {
        type: 'KeyValue',
        pairs: [
          { key: 'id', value: pack.id },
          { key: 'description', value: pack.description },
          { key: 'allowedTools', value: pack.allowedTools || '(none)' },
          { key: 'model', value: pack.model ?? '(default)' },
        ],
      },
      {
        type: 'DiffView',
        filename: `tech-packs/${pack.id}.json`,
        before: '',
        after: JSON.stringify(pack, null, 2),
      },
      {
        type: 'Callout',
        tone: 'info',
        text: 'Approving REGISTERS this pack into the shared cross-project library — every project that declares it will resolve it.',
      },
    );
  } else {
    const { packId, rationale } = candidate;
    elements.push(
      { type: 'Heading', text: `Adopt existing tech-pack: ${packId}`, level: 2 },
      { type: 'Text', text: rationale },
      {
        type: 'KeyValue',
        pairs: [{ key: 'adopt pack id', value: packId }],
      },
      {
        type: 'Callout',
        tone: 'info',
        text: `Approving DECLARES "${packId}" in this project's manifest (the pack body already exists in the library).`,
      },
    );
  }

  elements.push(
    { type: 'OptionButton', optionId: APPROVE_OPTION, label: 'Approve', recommended: true },
    { type: 'OptionButton', optionId: REJECT_OPTION, label: 'Reject' },
  );

  return { elements };
}

/** Narrow an arbitrary human-supplied optionId to a valid {@link ApprovalDecision}.
 *  Anything that is not the explicit approve id is treated as a reject (fail safe —
 *  an ambiguous answer never silently persists a pack). */
export function toApprovalDecision(optionId: string | null | undefined): ApprovalDecision {
  return optionId === APPROVE_OPTION ? APPROVE_OPTION : REJECT_OPTION;
}

/**
 * Apply a human decision to a candidate. APPROVE commits (CREATE → registerPack;
 * ADOPT → addManifestPack); REJECT drops it (no write). This is the only
 * side-effecting step — the card builder above is pure.
 */
export function applyApproval(
  project: string,
  candidate: PackCandidate,
  decision: ApprovalDecision,
): ApprovalResult {
  if (decision !== APPROVE_OPTION) {
    return { decision: REJECT_OPTION, applied: false };
  }
  if (candidate.kind === 'create') {
    const pack = registerPack(candidate.pack);
    return { decision: APPROVE_OPTION, applied: true, kind: 'create', pack };
  }
  const packs = addManifestPack(project, candidate.packId);
  return { decision: APPROVE_OPTION, applied: true, kind: 'adopt', packId: candidate.packId, packs };
}
