/**
 * Corpus for reviewer-lab. Each case is a leaf the daemon might see:
 *   base    — the repo before the implement node ran (committed).
 *   after   — the implement node's working-tree result (path -> content, null = delete).
 *   blueprint — the acceptance criteria the review node checks against.
 *   expected — the NET reviewer verdict we WANT (accept = ship it, reject = gate it).
 *
 * A GREEN mechanical gate is assumed (compiles/tests pass) — the review node's job is the
 * SEMANTIC check on top. "accept" cases are correct impls the reviewer must NOT over-reject;
 * "reject" cases carry a real, falsifiable defect the reviewer must catch.
 */
export interface Case {
  id: string;
  lang: string;
  concept: string;
  complexity: 'simple' | 'medium' | 'complex';
  expected: 'accept' | 'reject';
  title: string;
  description: string;
  blueprint: string;
  base: Record<string, string>;
  after: Record<string, string | null>;
}

const bp = (criteria: string[], prose = ''): string =>
  `${prose ? prose + '\n\n' : ''}ACCEPTANCE CRITERIA:\n${criteria.map((c) => `- ${c}`).join('\n')}`;

export const CASES: Case[] = [
  // ─────────────────────────── ACCEPT (correct impls) ───────────────────────────
  {
    id: 'ts-nullguard-ok',
    lang: 'ts', concept: 'null-guard', complexity: 'simple', expected: 'accept',
    title: 'Guard getUser against a missing id',
    description: 'Return null when id is empty instead of indexing undefined.',
    blueprint: bp([
      'getUser returns null when `id` is empty/falsy, before touching the map',
      'existing lookup behavior for a real id is unchanged',
    ]),
    base: {
      'src/users.ts':
`export const db: Record<string, { name: string }> = { u1: { name: 'Ada' } };

export function getUser(id: string) {
  return db[id];
}
`,
    },
    after: {
      'src/users.ts':
`export const db: Record<string, { name: string }> = { u1: { name: 'Ada' } };

export function getUser(id: string) {
  if (!id) return null;
  return db[id];
}
`,
    },
  },
  {
    id: 'py-avg-ok',
    lang: 'python', concept: 'correct-feature', complexity: 'simple', expected: 'accept',
    title: 'Add mean() helper',
    description: 'Compute the arithmetic mean; empty list returns 0.0.',
    blueprint: bp([
      'mean(xs) returns the arithmetic mean of xs',
      'mean([]) returns 0.0 (no ZeroDivisionError)',
    ]),
    base: { 'stats.py': `def total(xs):\n    return sum(xs)\n` },
    after: { 'stats.py': `def total(xs):\n    return sum(xs)\n\n\ndef mean(xs):\n    if not xs:\n        return 0.0\n    return sum(xs) / len(xs)\n` },
  },
  {
    id: 'go-errwrap-ok',
    lang: 'go', concept: 'error-handling', complexity: 'medium', expected: 'accept',
    title: 'Wrap the parse error with context',
    description: 'Return a wrapped error including the filename.',
    blueprint: bp([
      'ReadConfig wraps the underlying error with %w and includes the path',
      'the happy path still returns the parsed Config',
    ]),
    base: {
      'config.go':
`package cfg

import "os"

type Config struct{ Raw []byte }

func ReadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &Config{Raw: b}, nil
}
`,
    },
    after: {
      'config.go':
`package cfg

import (
	"fmt"
	"os"
)

type Config struct{ Raw []byte }

func ReadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	return &Config{Raw: b}, nil
}
`,
    },
  },
  {
    id: 'ts-scopeboundary-ok',
    lang: 'ts', concept: 'scope-boundary-nongoal', complexity: 'complex', expected: 'accept',
    title: 'Add retry to fetchJson only',
    description: 'Add bounded retry to fetchJson. Do NOT touch the logger module (explicit non-goal).',
    blueprint: bp([
      'fetchJson attempts the request at most 3 times total on a thrown error before rethrowing',
      'the maximum attempt count is 3',
    ], 'NON-GOALS: do not modify src/logger.ts — logging format is owned by another leaf.'),
    base: {
      'src/http.ts':
`export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}
`,
      'src/logger.ts': `export const log = (m: string) => console.log(m);\n`,
    },
    after: {
      'src/http.ts':
`export async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      return res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
`,
      // logger.ts intentionally untouched
    },
  },
  {
    id: 'js-oneline-ok',
    lang: 'js', concept: 'terse-one-line', complexity: 'simple', expected: 'accept',
    title: 'Fix off-by-one in slice',
    description: 'lastN returns the last n items; when n exceeds length it clamps to the whole array.',
    // NOTE: label corrected 2026-07-18 — an earlier version omitted the clamp requirement and the
    // impl returned slice(len-n), which for n>len returns the last (len-n magnitude) items, not all.
    // sonnet/medium correctly flagged that edge; the clean "accept" test requires a clamped impl.
    blueprint: bp([
      'lastN(arr, n) returns exactly the last n elements when n <= arr.length',
      'when n > arr.length it returns the whole array (clamped, never fewer elements)',
    ]),
    base: { 'util.js': `function lastN(arr, n) {\n  return arr.slice(arr.length - n + 1);\n}\nmodule.exports = { lastN };\n` },
    after: { 'util.js': `function lastN(arr, n) {\n  return arr.slice(Math.max(0, arr.length - n));\n}\nmodule.exports = { lastN };\n` },
  },
  {
    id: 'sql-addcol-ok',
    lang: 'sql', concept: 'migration', complexity: 'simple', expected: 'accept',
    title: 'Add nullable created_at column',
    description: 'Add created_at TIMESTAMP to users.',
    blueprint: bp([
      'migration adds a created_at column to the users table',
      'the column is nullable (no default backfill required)',
    ]),
    base: { 'migrations/001_users.sql': `CREATE TABLE users (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL\n);\n` },
    after: { 'migrations/002_created_at.sql': `ALTER TABLE users ADD COLUMN created_at TIMESTAMP;\n` },
  },
  {
    id: 'rust-option-ok',
    lang: 'rust', concept: 'option-handling', complexity: 'medium', expected: 'accept',
    title: 'Return Option instead of panicking',
    description: 'first_word returns None for an empty string rather than panicking.',
    blueprint: bp([
      'first_word returns Option<&str>',
      'an empty input yields None (no panic / no unwrap on empty)',
    ]),
    base: {
      'src/lib.rs':
`pub fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap()
}
`,
    },
    after: {
      'src/lib.rs':
`pub fn first_word(s: &str) -> Option<&str> {
    s.split_whitespace().next()
}
`,
    },
  },
  {
    id: 'ts-retained-ok',
    lang: 'ts', concept: 'retained-code', complexity: 'medium', expected: 'accept',
    title: 'Expose isAdmin via existing role field',
    description: 'Add isAdmin() using the already-present role field; no schema change needed.',
    blueprint: bp([
      'isAdmin(user) returns true iff user.role === "admin"',
      'reuses the existing role field (no new field added)',
    ]),
    base: {
      'src/auth.ts':
`export interface User { id: string; role: string; }

export function canLogin(u: User) {
  return !!u.id;
}
`,
    },
    after: {
      'src/auth.ts':
`export interface User { id: string; role: string; }

export function canLogin(u: User) {
  return !!u.id;
}

export function isAdmin(u: User) {
  return u.role === 'admin';
}
`,
    },
  },

  // ─────────────────────────── REJECT (real defects) ───────────────────────────
  {
    id: 'ts-nullguard-bug',
    lang: 'ts', concept: 'missing-null-guard', complexity: 'simple', expected: 'reject',
    title: 'Guard getUser against a missing id',
    description: 'Return null when id is empty instead of indexing undefined.',
    blueprint: bp([
      'getUser returns null when `id` is empty/falsy, before touching the map',
      'existing lookup behavior for a real id is unchanged',
    ]),
    base: {
      'src/users.ts':
`export const db: Record<string, { name: string }> = { u1: { name: 'Ada' } };

export function getUser(id: string) {
  return db[id];
}
`,
    },
    // impl "refactored" but never added the guard — the required criterion is UNMET.
    after: {
      'src/users.ts':
`export const db: Record<string, { name: string }> = { u1: { name: 'Ada' } };

export function getUser(id: string) {
  const row = db[id];
  return row;
}
`,
    },
  },
  {
    id: 'py-offbyone-bug',
    lang: 'python', concept: 'off-by-one', complexity: 'medium', expected: 'reject',
    title: 'Sum the first k items',
    description: 'sum_first(xs, k) sums xs[0..k].',
    blueprint: bp([
      'sum_first(xs, k) returns the sum of the first k elements of xs',
      'sum_first([1,2,3], 2) == 3',
    ]),
    base: { 'agg.py': `def sum_first(xs, k):\n    return 0\n` },
    // off-by-one: includes k+1 elements (range end k+1) — sum_first([1,2,3],2) == 6, not 3.
    after: { 'agg.py': `def sum_first(xs, k):\n    total = 0\n    for i in range(k + 1):\n        total += xs[i]\n    return total\n` },
  },
  {
    id: 'go-ignorederr-bug',
    lang: 'go', concept: 'ignored-error', complexity: 'medium', expected: 'reject',
    title: 'Wrap the parse error with context',
    description: 'Return a wrapped error including the filename.',
    blueprint: bp([
      'ReadConfig wraps the underlying error with %w and includes the path',
      'the happy path still returns the parsed Config',
    ]),
    base: {
      'config.go':
`package cfg

import "os"

type Config struct{ Raw []byte }

func ReadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &Config{Raw: b}, nil
}
`,
    },
    // swallows the error entirely (returns nil, nil on failure) — worse than base.
    after: {
      'config.go':
`package cfg

import "os"

type Config struct{ Raw []byte }

func ReadConfig(path string) (*Config, error) {
	b, _ := os.ReadFile(path)
	return &Config{Raw: b}, nil
}
`,
    },
  },
  {
    id: 'rust-unwrap-bug',
    lang: 'rust', concept: 'unwrap-panic', complexity: 'simple', expected: 'reject',
    title: 'Return Option instead of panicking',
    description: 'first_word returns None for an empty string rather than panicking.',
    blueprint: bp([
      'first_word returns Option<&str>',
      'an empty input yields None (no panic / no unwrap on empty)',
    ]),
    base: {
      'src/lib.rs':
`pub fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap()
}
`,
    },
    // signature changed to Option but STILL unwraps then re-wraps — panics on empty.
    after: {
      'src/lib.rs':
`pub fn first_word(s: &str) -> Option<&str> {
    Some(s.split_whitespace().next().unwrap())
}
`,
    },
  },
  {
    id: 'ts-incomplete-bug',
    lang: 'ts', concept: 'incomplete-impl', complexity: 'complex', expected: 'reject',
    title: 'Add validate() with three rules',
    description: 'validate(form) must enforce email, non-empty name, and age >= 18.',
    blueprint: bp([
      'validate returns an error for a missing "@" in email',
      'validate returns an error for an empty name',
      'validate returns an error when age < 18',
    ]),
    base: {
      'src/validate.ts':
`export interface Form { email: string; name: string; age: number; }
export function validate(f: Form): string[] {
  return [];
}
`,
    },
    // only two of three rules implemented — the age >= 18 rule is missing (UNMET criterion).
    after: {
      'src/validate.ts':
`export interface Form { email: string; name: string; age: number; }
export function validate(f: Form): string[] {
  const errs: string[] = [];
  if (!f.email.includes('@')) errs.push('bad email');
  if (f.name.trim() === '') errs.push('empty name');
  return errs;
}
`,
    },
  },
  {
    id: 'js-wronglogic-bug',
    lang: 'js', concept: 'wrong-logic', complexity: 'medium', expected: 'reject',
    title: 'canAccess requires active AND paid',
    description: 'A user may access only if active AND paid.',
    blueprint: bp([
      'canAccess(u) returns true only when u.active AND u.paid are both true',
    ]),
    base: { 'access.js': `function canAccess(u) {\n  return false;\n}\nmodule.exports = { canAccess };\n` },
    // uses OR instead of AND — grants access to unpaid active users.
    after: { 'access.js': `function canAccess(u) {\n  return u.active || u.paid;\n}\nmodule.exports = { canAccess };\n` },
  },
  {
    id: 'ts-stub-bug',
    lang: 'ts', concept: 'stub-todo', complexity: 'simple', expected: 'reject',
    title: 'Implement computeTax',
    description: 'computeTax(amount) returns amount * 0.2.',
    blueprint: bp([
      'computeTax(amount) returns amount multiplied by 0.2',
    ]),
    base: { 'src/tax.ts': `export function computeTax(amount: number): number {\n  return 0;\n}\n` },
    // left as a stub with a TODO — criterion UNMET.
    after: { 'src/tax.ts': `export function computeTax(amount: number): number {\n  // TODO: implement tax calculation\n  return 0;\n}\n` },
  },
];
