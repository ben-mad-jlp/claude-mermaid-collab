import { describe, it, expect } from 'vitest';
import { hasLegacyAnnotations, migrateInlineAnnotations } from '../migrator';
import { computeChecksum } from '../anchor';

describe('annotations/migrator', () => {
  it('detects legacy markers', () => {
    expect(hasLegacyAnnotations('hello <!-- comment-start: x --> world <!-- comment-end -->')).toBe(true);
    expect(hasLegacyAnnotations('nothing to see here')).toBe(false);
  });

  it('extracts comment annotations and strips markers', () => {
    const md = 'before <!-- comment-start: hdr -->target text<!-- comment-end --> after';
    const { cleanedMarkdown, annotations } = migrateInlineAnnotations(md);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].kind).toBe('comment');
    expect(annotations[0].anchor.text).toBe('target text');
    expect(cleanedMarkdown).toBe('before target text after');
  });

  it('extracts propose/approve/reject', () => {
    const md =
      '<!-- propose-start -->p<!-- propose-end --> ' +
      '<!-- approve-start -->a<!-- approve-end --> ' +
      '<!-- reject-start: because -->r<!-- reject-end -->';
    const { annotations } = migrateInlineAnnotations(md);
    const kinds = annotations.map((a) => a.kind).sort();
    expect(kinds).toEqual(['approved', 'proposed', 'rejected']);
    const rej = annotations.find((a) => a.kind === 'rejected');
    expect(rej?.reason).toBe('because');
  });
});

describe('annotations/anchor checksum', () => {
  it('is deterministic and 8 hex chars', () => {
    const a = computeChecksum('hello world');
    const b = computeChecksum('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for different inputs', () => {
    expect(computeChecksum('a')).not.toBe(computeChecksum('b'));
  });
});
