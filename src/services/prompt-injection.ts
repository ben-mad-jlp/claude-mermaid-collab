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
import { getActiveConstraints } from './decision-record-store';

export interface ComposeInjectedContextArgs {
  kind: LeafNodeKind;
  project: string;
  epicId?: string | null;
  flags: InjectionFlags;
}

/** Distinctive advisory marker — the source-guard test asserts it lives in exactly this file. */
const ADVISORY_SUFFIX = 'advisory — verify against the tree';

/** Node kinds that can benefit from active constraints. */
const CONSTRAINTS_KINDS = new Set<LeafNodeKind>(['implement', 'wimplement', 'fix', 'review']);

/** Wrap one payload body in a clearly-delimited advisory block. Exported for the shape test. */
export function _wrapBlock(name: string, body: string): string {
  return `\n\n=== ${name} (${ADVISORY_SUFFIX}) ===\n${body}\n=== end ${name} ===`;
}

/** Join non-empty blocks; no blocks ⇒ ''. */
function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim().length > 0).join('');
}

/**
 * Assemble the injected system-prompt context for one node. Returns '' when no payload seam
 * contributes (always, in this leaf). Callers pass `composeInjectedContext(...) || undefined`
 * so an empty result leaves appendSystemPrompt undefined.
 */
export function composeInjectedContext(args: ComposeInjectedContextArgs): string {
  const blocks: string[] = [];
  // TODO(payload B — serves prompt-injection retryContext criterion, later leaf): when
  //   args.flags.retryContext, push _wrapBlock('RETRY CONTEXT', <retry-context payload>).
  // Payload C — serves prompt-injection activeConstraints criterion. Epic-scoped ∪
  // project-level active constraints as an advisory block (constraint text = `title`).
  if (args.flags.activeConstraints && CONSTRAINTS_KINDS.has(args.kind)) {
    const constraints = getActiveConstraints(args.project, args.epicId);
    if (constraints.length > 0) {
      const body = constraints.map((c) => `- ${c.id}: ${c.title}`).join('\n');
      blocks.push(_wrapBlock('ACTIVE CONSTRAINTS', body));
    }
  }
  // TODO(payload A — serves projectDigest criterion, later leaf): when args.flags.digest,
  //   push _wrapBlock('PROJECT DIGEST', <digest payload>).
  return joinBlocks(blocks);
}
