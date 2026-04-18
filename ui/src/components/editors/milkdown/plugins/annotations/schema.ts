/**
 * Annotation schema types and helpers.
 *
 * Annotations are stored in document metadata (not inline HTML comments).
 * Each annotation carries a position-resilient anchor (from/to + text +
 * checksum) so a decoration plugin can re-locate the highlighted range on
 * load, even if the surrounding markdown has shifted.
 */

export type AnnotationKind = 'comment' | 'proposed' | 'approved' | 'rejected';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  anchor: { from: number; to: number; text: string; checksum: string };
  body: string;
  author?: string;
  createdAt: number;
  resolvedAt?: number;
  reason?: string;
}

export interface AnnotationsMetadata {
  annotations: Annotation[];
  schemaVersion: number;
}

export const ANNOTATIONS_SCHEMA_VERSION = 1;

export function createAnnotationId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return Math.random().toString(36).slice(2);
}

export function isAnnotation(x: unknown): x is Annotation {
  if (!x || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  if (typeof a.id !== 'string') return false;
  if (
    a.kind !== 'comment' &&
    a.kind !== 'proposed' &&
    a.kind !== 'approved' &&
    a.kind !== 'rejected'
  ) {
    return false;
  }
  if (!a.anchor || typeof a.anchor !== 'object') return false;
  const anchor = a.anchor as Record<string, unknown>;
  if (
    typeof anchor.from !== 'number' ||
    typeof anchor.to !== 'number' ||
    typeof anchor.text !== 'string' ||
    typeof anchor.checksum !== 'string'
  ) {
    return false;
  }
  if (typeof a.body !== 'string') return false;
  if (typeof a.createdAt !== 'number') return false;
  return true;
}
