/**
 * Document metadata schema (server-side).
 *
 * Mirrors the UI-side Annotation shape. Stubbed for now: NOT yet wired into
 * document-manager.ts — that wiring lands in a follow-up task. This module
 * exists so the server can validate incoming metadata blobs without the UI
 * having to cross-import from the ui/ tree.
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

export interface DocumentMetadata {
  annotations?: Annotation[];
  annotationsSchemaVersion?: number;
  [key: string]: unknown;
}

export const CURRENT_METADATA_VERSION = 1;

export const EMPTY_METADATA: DocumentMetadata = {};

function isAnnotationKind(x: unknown): x is AnnotationKind {
  return x === 'comment' || x === 'proposed' || x === 'approved' || x === 'rejected';
}

function validateAnnotation(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== 'string') return null;
  if (!isAnnotationKind(a.kind)) return null;
  if (!a.anchor || typeof a.anchor !== 'object') return null;
  const anchor = a.anchor as Record<string, unknown>;
  if (
    typeof anchor.from !== 'number' ||
    typeof anchor.to !== 'number' ||
    typeof anchor.text !== 'string' ||
    typeof anchor.checksum !== 'string'
  ) {
    return null;
  }
  if (typeof a.body !== 'string') return null;
  if (typeof a.createdAt !== 'number') return null;

  const validated: Annotation = {
    id: a.id,
    kind: a.kind,
    anchor: {
      from: anchor.from,
      to: anchor.to,
      text: anchor.text,
      checksum: anchor.checksum,
    },
    body: a.body,
    createdAt: a.createdAt,
  };
  if (typeof a.author === 'string') validated.author = a.author;
  if (typeof a.resolvedAt === 'number') validated.resolvedAt = a.resolvedAt;
  if (typeof a.reason === 'string') validated.reason = a.reason;
  return validated;
}

/**
 * Shallow runtime validation. Drops malformed annotations silently rather than
 * throwing — document saves must never fail because of a single bad record.
 */
export function validateDocumentMetadata(raw: unknown): DocumentMetadata {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_METADATA };
  const r = raw as Record<string, unknown>;
  const out: DocumentMetadata = {};

  if (Array.isArray(r.annotations)) {
    const valid: Annotation[] = [];
    for (const item of r.annotations) {
      const v = validateAnnotation(item);
      if (v) valid.push(v);
    }
    out.annotations = valid;
  }

  if (typeof r.annotationsSchemaVersion === 'number') {
    out.annotationsSchemaVersion = r.annotationsSchemaVersion;
  }

  // Pass through unknown keys so callers can evolve the schema incrementally.
  for (const [key, value] of Object.entries(r)) {
    if (key === 'annotations' || key === 'annotationsSchemaVersion') continue;
    out[key] = value;
  }

  return out;
}
