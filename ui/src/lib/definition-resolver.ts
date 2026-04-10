/**
 * definition-resolver
 *
 * Pure function that maps source-link candidates + the session's linked
 * snippets into a navigation decision. Used by Feature B (cross-file
 * navigation) to decide between jumping to an already-linked snippet,
 * offering to link a new file, showing a picker, or giving up.
 */

import type { SourceLinkCandidate } from './pseudo-api';

export interface FoundLinkedSnippet {
  type: 'found-linked';
  snippetId: string;
  line: number;
}

export interface NeedsLink {
  type: 'needs-link';
  candidate: SourceLinkCandidate;
}

export interface NeedsLinkPicker {
  type: 'needs-link-picker';
  candidates: SourceLinkCandidate[];
}

export interface NotFound {
  type: 'not-found';
}

export type ResolveDecision =
  | FoundLinkedSnippet
  | NeedsLink
  | NeedsLinkPicker
  | NotFound;

export interface LinkedSnippetRef {
  id: string;
  filePath: string;
}

/**
 * Decide how to navigate to a symbol's definition given the source-link
 * candidates from the pseudo-db and the set of linked snippets currently
 * in the session.
 *
 * Rules:
 *  - No candidates → not-found.
 *  - Exactly one candidate:
 *      - If linked → found-linked (use snippet id + candidate line, fallback to 1).
 *      - If not linked → needs-link.
 *  - Multiple candidates:
 *      - Build list of (candidate, matching-linked-snippet) pairs.
 *      - If exactly one distinct source path among candidates AND at least one
 *        matching linked snippet → found-linked (first match).
 *      - Otherwise → needs-link-picker (let the user choose).
 */
export function resolveDefinition(
  candidates: SourceLinkCandidate[],
  linkedSnippets: LinkedSnippetRef[],
): ResolveDecision {
  if (!candidates || candidates.length === 0) {
    return { type: 'not-found' };
  }

  // Build a fast lookup from source path → snippet id
  const byPath = new Map<string, string>();
  for (const snip of linkedSnippets) {
    if (snip.filePath) byPath.set(snip.filePath, snip.id);
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    const snippetId = byPath.get(only.sourceFilePath);
    if (snippetId) {
      return {
        type: 'found-linked',
        snippetId,
        line: only.sourceLine ?? 1,
      };
    }
    return { type: 'needs-link', candidate: only };
  }

  // Multiple candidates — check if they all point at the same source path
  const distinctPaths = new Set(candidates.map((c) => c.sourceFilePath));
  if (distinctPaths.size === 1) {
    // All point at the same file — if it's linked, jump there
    const only = candidates[0];
    const snippetId = byPath.get(only.sourceFilePath);
    if (snippetId) {
      return {
        type: 'found-linked',
        snippetId,
        line: only.sourceLine ?? 1,
      };
    }
    return { type: 'needs-link', candidate: only };
  }

  // Multiple candidates with different paths — let the user pick
  return { type: 'needs-link-picker', candidates };
}
