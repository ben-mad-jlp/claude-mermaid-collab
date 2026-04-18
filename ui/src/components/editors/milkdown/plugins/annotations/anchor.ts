/**
 * Position-resilient anchor helpers for annotations.
 *
 * Anchors store a ProseMirror (from, to) range plus the underlying text and a
 * cheap FNV-1a checksum. On load we first try the cached range and verify the
 * checksum; on mismatch we fall back to scanning the document's text content
 * for the original string.
 */

import type { Node as ProseMirrorNode } from '@milkdown/prose/model';
import type { Annotation } from './schema';

/**
 * FNV-1a 32-bit checksum rendered as 8-char hex. Deterministic, dependency-
 * free, good enough for drift detection (NOT cryptographic).
 */
export function computeChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply with Math.imul to stay in int32 land.
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit then hex-pad.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createAnchor(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): Annotation['anchor'] {
  const text = doc.textBetween(from, to, '\n', '\n');
  return {
    from,
    to,
    text,
    checksum: computeChecksum(text),
  };
}

/**
 * Attempt to resolve an anchor against the current document.
 * - First try the cached (from, to) range and verify checksum.
 * - Otherwise scan doc.textContent for anchor.text and compute PM positions
 *   by walking the doc (approximation via textContent indexOf + offset).
 */
export function resolveAnchor(
  doc: ProseMirrorNode,
  anchor: Annotation['anchor'],
): { from: number; to: number } | null {
  const docSize = doc.content.size;

  // 1. Exact range + checksum match.
  if (
    anchor.from >= 0 &&
    anchor.to <= docSize &&
    anchor.from <= anchor.to
  ) {
    try {
      const currentText = doc.textBetween(anchor.from, anchor.to, '\n', '\n');
      if (computeChecksum(currentText) === anchor.checksum) {
        return { from: anchor.from, to: anchor.to };
      }
    } catch {
      // fall through
    }
  }

  // 2. Fallback: scan full text content for anchor.text.
  if (!anchor.text) return null;
  const fullText = doc.textBetween(0, docSize, '\n', '\n');
  const idx = fullText.indexOf(anchor.text);
  if (idx < 0) return null;

  // Map string offset back to PM positions by walking text nodes.
  const start = mapTextOffsetToPos(doc, idx);
  const end = mapTextOffsetToPos(doc, idx + anchor.text.length);
  if (start == null || end == null) return null;
  return { from: start, to: end };
}

/**
 * Walk the document summing text-node lengths until we reach `offset`.
 * Mirrors textBetween's separator semantics: a '\n' is inserted each time a
 * new textblock starts after a previous one, and for each non-text inline
 * leaf (hard_break, image, etc. — leafText was '\n' at the caller).
 */
function mapTextOffsetToPos(doc: ProseMirrorNode, offset: number): number | null {
  if (offset < 0) return null;
  let consumed = 0;
  let resultPos: number | null = null;
  let seenTextblock = false;

  doc.descendants((node, pos) => {
    if (resultPos !== null) return false;
    if (node.isTextblock) {
      if (seenTextblock) {
        // Between textblocks, textBetween inserts blockSeparator ('\n').
        if (consumed >= offset) {
          resultPos = pos;
          return false;
        }
        consumed += 1;
      }
      seenTextblock = true;
      return true;
    }
    if (node.isText) {
      const len = node.text?.length ?? 0;
      if (consumed + len >= offset) {
        resultPos = pos + (offset - consumed);
        return false;
      }
      consumed += len;
      return false;
    }
    // Non-text inline leaves (hard_break, image) get leafText ('\n').
    if (node.isLeaf) {
      if (consumed + 1 > offset) {
        resultPos = pos;
        return false;
      }
      consumed += 1;
      return false;
    }
    return true;
  });

  if (resultPos === null && consumed === offset) {
    resultPos = doc.content.size;
  }
  return resultPos;
}
