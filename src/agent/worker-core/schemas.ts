/**
 * Typed handoff schemas — the ONLY things that cross worker-core phase boundaries.
 *
 * The discipline (design-grok-worker-discipline §2.3) is: fresh context per phase,
 * and a phase receives ONLY the prior phase's typed object — never its scrollback.
 * These Zod schemas ARE those boundaries; each phase's `generateObject` is validated
 * against one, so a malformed verdict is caught (and fail-safed toward escalation),
 * never silently trusted. Provider-agnostic — no model/provider coupling here.
 */
import { z } from 'zod';

/** sizegate → (host). Whether the leaf is too big, and a drafted split. */
export const SplitProposalSchema = z.object({
  oversized: z.boolean(),
  reason: z.string().optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string(),
        files: z.array(z.string()).default([]),
        type: z.string().optional(),
      }),
    )
    .default([]),
});
export type SplitProposal = z.infer<typeof SplitProposalSchema>;

/** research → implement. The per-todo blueprint (files + plan + diagram-as-spec). */
export const ResearchFindingsSchema = z.object({
  filesToEdit: z.array(z.string()).default([]),
  plan: z.string(),
  testCommand: z.string().optional(),
  behavioral: z.boolean(),
  /** Name of the before/after diagram posted to the collab tree (the contract
   *  verify/review judge the change-set against). */
  specDiagramName: z.string().optional(),
  /** Id returned by create_diagram for the before/after diagram-as-spec — passed to
   *  verify/review so they read the contract back via get_diagram. */
  specDiagramId: z.string().optional(),
});
export type ResearchFindings = z.infer<typeof ResearchFindingsSchema>;

/** verify → (host fix loop). Pass + the error signatures that drive stuck-detection. */
export const VerifyVerdictSchema = z.object({
  pass: z.boolean(),
  failingChecks: z.array(z.string()).default([]),
  errorSignatures: z.array(z.string()).default([]),
});
export type VerifyVerdict = z.infer<typeof VerifyVerdictSchema>;

/** review → (host). Completeness verdict + concrete gaps for a gap-fix pass. */
export const ReviewVerdictSchema = z.object({
  complete: z.boolean(),
  gaps: z.array(z.string()).default([]),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
