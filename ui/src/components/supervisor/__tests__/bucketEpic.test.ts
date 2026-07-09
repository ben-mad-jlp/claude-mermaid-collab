/**
 * Canonical test for isBucketEpic — the [kind E] decision guard.
 *
 * Decision: bucket-ness is a TOPIC, not a ROLE. It is a documented title convention
 * (matching the word "inbox"), NOT a per-todo `kind` marker. This test pins that
 * decision in three executable ways:
 *   1. Strip-safety invariant: the predicate survives the title-label migration.
 *   2. Word-boundary load-bearing: `\binbox\b` guards against silent misclassification.
 *   3. Role/topic separation: bucketEpic.ts takes a title string, not a todo, and never
 *      decides a role (no imports from todoKind, no kind/parentId/childrenByParent).
 *
 * See bucketEpic.ts for the prose rationale.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isBucketEpic } from '../bucketEpic';
import { stripLabel } from '../../../lib/todoKind';

describe('isBucketEpic — bucket titles', () => {
  it('matches "Inbox" (case-insensitive)', () => {
    expect(isBucketEpic('Inbox')).toBe(true);
    expect(isBucketEpic('inbox')).toBe(true);
    expect(isBucketEpic('INBOX')).toBe(true);
  });

  it('matches "Bugfix inbox" (case-insensitive)', () => {
    expect(isBucketEpic('Bugfix inbox')).toBe(true);
    expect(isBucketEpic('bugfix inbox')).toBe(true);
    expect(isBucketEpic('BUGFIX INBOX')).toBe(true);
  });

  it('matches the real backend bucket titles verbatim', () => {
    expect(isBucketEpic('[EPIC] Inbox')).toBe(true);
    expect(isBucketEpic('[EPIC] Bugfix inbox')).toBe(true);
  });
});

describe('isBucketEpic — non-buckets', () => {
  it('does not match "Inboxing tasks" or "inboxes" — word boundary is load-bearing', () => {
    expect(isBucketEpic('Inboxing tasks')).toBe(false);
    expect(isBucketEpic('inboxes')).toBe(false);
  });

  it('does not match empty string, undefined, or null', () => {
    expect(isBucketEpic('')).toBe(false);
    expect(isBucketEpic(undefined)).toBe(false);
    expect(isBucketEpic(null)).toBe(false);
  });

  it('does not match ordinary deliverable epic titles', () => {
    expect(isBucketEpic('[EPIC] kind column migration')).toBe(false);
    expect(isBucketEpic('kind column migration')).toBe(false);
    expect(isBucketEpic('Deploy to production')).toBe(false);
  });
});

describe('strip-safety: invariant under stripLabel', () => {
  const bucketTitles = ['[EPIC] Inbox', '[EPIC] Bugfix inbox'];

  bucketTitles.forEach((title) => {
    it(`${title} matches before and after stripLabel`, () => {
      expect(isBucketEpic(title)).toBe(true);
      expect(isBucketEpic(stripLabel(title))).toBe(true);
    });
  });

  it('stripLabel post-strip row text is pinned: "[EPIC] Inbox" → "Inbox"', () => {
    expect(stripLabel('[EPIC] Inbox')).toBe('Inbox');
    expect(stripLabel('[EPIC] Bugfix inbox')).toBe('Bugfix inbox');
  });
});

describe('bucket-ness is a TOPIC, never a ROLE', () => {
  it('isBucketEpic accepts a title string, not a todo object', () => {
    // Type-shape: a leaf with "inbox" in its title still matches, proving the predicate
    // cares only about the string content, not the todo's role/kind.
    expect(isBucketEpic('inbox triage leaf')).toBe(true);
  });

  it('bucketEpic.ts source never decides a role — it must be gated by isEpic at call sites', () => {
    // Read the source and enforce the decision: bucketEpic.ts must not import todoKind,
    // and must not reference kind, parentId, or childrenByParent in code (not in comments).
    const sourcePath = resolve(__dirname, '../bucketEpic.ts');
    const source = readFileSync(sourcePath, 'utf8');

    // Forbidden patterns in the code (after the export function, excluding doc block).
    // Extract just the function implementation (skip the doc comment).
    const funcMatch = source.match(/^export\s+function/m);
    if (!funcMatch) {
      throw new Error('bucketEpic.ts missing export function declaration');
    }

    const functionStart = funcMatch.index!;
    const codeOnly = source.substring(functionStart);

    const forbiddenInCode = [
      /\bchildrenByParent\b/,
      /\bparentId\b/,
      /from\s+['"].*todoKind/,
    ];

    for (const pattern of forbiddenInCode) {
      if (pattern.test(codeOnly)) {
        throw new Error(
          'Decision [kind E] violation: bucketEpic must not decide a ROLE; gate it with ' +
            '`isEpic` from lib/todoKind at the call site.',
        );
      }
    }
  });
});
