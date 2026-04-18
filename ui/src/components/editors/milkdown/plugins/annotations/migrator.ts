/**
 * One-shot migrator from legacy inline annotation markers to structured
 * Annotation records.
 *
 * The legacy AnnotationToolbar wrapped selections with HTML comments:
 *   <!-- comment-start: ... --> ... <!-- comment-end -->
 *   <!-- propose-start --> ... <!-- propose-end -->
 *   <!-- approve-start --> ... <!-- approve-end -->
 *   <!-- reject-start: reason --> ... <!-- reject-end -->
 *
 * This pass extracts each wrapped range into an Annotation (with placeholder
 * 0/0 positions — resolveAnchor's text-scan fallback relocates them on load),
 * then strips the markers from the markdown.
 */

import { type Annotation, createAnnotationId } from './schema';
import { computeChecksum } from './anchor';

const LEGACY_PATTERNS: RegExp[] = [
  /<!--\s*comment-start[^>]*-->/,
  /<!--\s*comment-end\s*-->/,
  /<!--\s*(?:propose|approve|reject)-start[^>]*-->/,
  /<!--\s*(?:propose|approve|reject)-end\s*-->/,
  /<!--\s*comment:[^>]*-->/,
  /<!--\s*status:\s*(?:proposed|approved|rejected)[^>]*-->/,
];

export function hasLegacyAnnotations(markdown: string): boolean {
  return LEGACY_PATTERNS.some((re) => re.test(markdown));
}

interface Extraction {
  kind: Annotation['kind'];
  inner: string;
  reason?: string;
}

export function migrateInlineAnnotations(markdown: string): {
  cleanedMarkdown: string;
  annotations: Annotation[];
} {
  const annotations: Annotation[] = [];
  let md = markdown;

  const pushAnnotation = ({ kind, inner, reason }: Extraction) => {
    const text = inner.trim();
    annotations.push({
      id: createAnnotationId(),
      kind,
      anchor: {
        from: 0,
        to: 0,
        text,
        checksum: computeChecksum(text),
      },
      body: kind === 'comment' ? text : '',
      createdAt: Date.now(),
      ...(reason ? { reason } : {}),
    });
  };

  // Comment ranges.
  md = md.replace(
    /<!--\s*comment-start:([\s\S]*?)-->([\s\S]*?)<!--\s*comment-end\s*-->/g,
    (_m, _hdr: string, inner: string) => {
      pushAnnotation({ kind: 'comment', inner });
      return inner;
    },
  );

  // Propose / approve ranges (shared shape).
  md = md.replace(
    /<!--\s*(propose|approve)-start\s*-->([\s\S]*?)<!--\s*\1-end\s*-->/g,
    (_m, kw: string, inner: string) => {
      const kind: Annotation['kind'] = kw === 'propose' ? 'proposed' : 'approved';
      pushAnnotation({ kind, inner });
      return inner;
    },
  );

  // Reject ranges with reason.
  md = md.replace(
    /<!--\s*reject-start:\s*([^>]*?)-->([\s\S]*?)<!--\s*reject-end\s*-->/g,
    (_m, reasonRaw: string, inner: string) => {
      pushAnnotation({ kind: 'rejected', inner, reason: reasonRaw.trim() });
      return inner;
    },
  );

  // Strip standalone block markers (legacy cursor-insert variant).
  md = md.replace(/<!--\s*comment:[^>]*-->/g, '');
  md = md.replace(/<!--\s*status:\s*(?:proposed|approved|rejected)[^>]*-->/g, '');

  // Collapse excess blank lines introduced by removed markers.
  md = md.replace(/\n{3,}/g, '\n\n');

  return { cleanedMarkdown: md, annotations };
}
