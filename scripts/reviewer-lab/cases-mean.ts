/**
 * MEAN corpus — the over-rejection inducers. Realistic noise, ambiguous blueprints, and
 * correct code that superficially LOOKS wrong. This is where the daemon reviewer historically
 * broke: hallucinating a defect in surrounding complexity and gating CORRECT work.
 * Also widens language coverage (java, c, bash, yaml).
 */
import type { Case } from './cases';

const bp = (criteria: string[], prose = ''): string =>
  `${prose ? prose + '\n\n' : ''}ACCEPTANCE CRITERIA:\n${criteria.map((c) => `- ${c}`).join('\n')}`;

export const MEAN: Case[] = [
  // correct, but the guard LOOKS redundant / the change is buried in a big function
  {
    id: 'M-looks-redundant-ok',
    lang: 'ts', concept: 'looks-redundant-but-correct', complexity: 'complex', expected: 'accept',
    title: 'Guard against NaN quantity in the cart total',
    description: 'Add a NaN guard. A skimming reviewer may call it redundant since prices are numbers — but quantity is user-supplied.',
    blueprint: bp([
      'computeTotal skips a line item whose quantity is NaN instead of poisoning the sum',
      'the discount and tax logic is unchanged',
    ]),
    base: {
      'src/cart.ts':
`export interface Line { sku: string; price: number; quantity: number; }

export function computeTotal(lines: Line[], discountRate: number, taxRate: number): number {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.price * line.quantity;
  }
  const discounted = subtotal * (1 - discountRate);
  const taxed = discounted * (1 + taxRate);
  return Math.round(taxed * 100) / 100;
}
`,
    },
    after: {
      'src/cart.ts':
`export interface Line { sku: string; price: number; quantity: number; }

export function computeTotal(lines: Line[], discountRate: number, taxRate: number): number {
  let subtotal = 0;
  for (const line of lines) {
    if (Number.isNaN(line.quantity)) continue;
    subtotal += line.price * line.quantity;
  }
  const discounted = subtotal * (1 - discountRate);
  const taxed = discounted * (1 + taxRate);
  return Math.round(taxed * 100) / 100;
}
`,
    },
  },
  // correct: intentional integer floor division; blueprint says "average (floor)"
  {
    id: 'M-intentional-floor-ok',
    lang: 'java', concept: 'intentional-truncation', complexity: 'medium', expected: 'accept',
    title: 'midpoint index (floor)',
    description: 'Return the floor midpoint index. Integer division is intended, not a bug.',
    blueprint: bp([
      'midpoint(lo, hi) returns the floor of (lo + hi) / 2',
      'the computation avoids integer overflow for large lo, hi',
    ]),
    base: { 'Search.java': `public class Search {\n    public static int midpoint(int lo, int hi) {\n        return lo;\n    }\n}\n` },
    // correct overflow-safe floor midpoint; the `>>> 1` and integer division may look suspicious.
    after: { 'Search.java': `public class Search {\n    public static int midpoint(int lo, int hi) {\n        return lo + ((hi - lo) >>> 1);\n    }\n}\n` },
  },
  // ambiguous blueprint; reasonable correct interpretation
  {
    id: 'M-ambiguous-trim-ok',
    lang: 'python', concept: 'ambiguous-spec', complexity: 'medium', expected: 'accept',
    title: 'normalize whitespace in a title',
    description: 'Blueprint says "clean up whitespace" — impl trims ends and collapses internal runs, a reasonable reading.',
    blueprint: bp([
      'normalize(s) removes leading/trailing whitespace',
      'internal runs of whitespace are cleaned up',
    ]),
    base: { 'norm.py': `def normalize(s):\n    return s\n` },
    after: { 'norm.py': `import re\n\n\ndef normalize(s):\n    return re.sub(r"\\s+", " ", s).strip()\n` },
  },
  // correct early-return refactor; reviewer must not claim a branch was lost
  {
    id: 'M-guard-refactor-ok',
    lang: 'go', concept: 'guard-clause-refactor', complexity: 'complex', expected: 'accept',
    title: 'Flatten nested validation into guard clauses',
    description: 'Refactor nested ifs into early returns. Behavior identical; reviewer must not claim a case was dropped.',
    blueprint: bp([
      'Validate returns an error for empty name, negative age, and missing email — same three cases as before',
      'the refactor uses early-return guard clauses',
    ]),
    base: {
      'validate.go':
`package v

import "errors"

type User struct {
	Name  string
	Age   int
	Email string
}

func Validate(u User) error {
	if u.Name != "" {
		if u.Age >= 0 {
			if u.Email != "" {
				return nil
			}
			return errors.New("missing email")
		}
		return errors.New("negative age")
	}
	return errors.New("empty name")
}
`,
    },
    after: {
      'validate.go':
`package v

import "errors"

type User struct {
	Name  string
	Age   int
	Email string
}

func Validate(u User) error {
	if u.Name == "" {
		return errors.New("empty name")
	}
	if u.Age < 0 {
		return errors.New("negative age")
	}
	if u.Email == "" {
		return errors.New("missing email")
	}
	return nil
}
`,
    },
  },
  // correct bash; set -euo pipefail and quoting look unusual but are right
  {
    id: 'M-bash-quoting-ok',
    lang: 'bash', concept: 'defensive-shell', complexity: 'medium', expected: 'accept',
    title: 'backup script copies only existing files',
    description: 'Copy each arg into dest if it exists. Correct quoting + existence check.',
    blueprint: bp([
      'the script copies each argument into $DEST only when the source file exists',
      'filenames with spaces are handled (arguments are quoted)',
    ]),
    base: { 'backup.sh': `#!/usr/bin/env bash\nDEST="$1"\nshift\n` },
    after: { 'backup.sh': `#!/usr/bin/env bash\nset -euo pipefail\nDEST="$1"\nshift\nfor f in "$@"; do\n  if [[ -f "$f" ]]; then\n    cp -- "$f" "$DEST"/\n  fi\ndone\n` },
  },

  // ───────── the mirror: real bugs hidden in realistic noise (must REJECT) ─────────
  {
    id: 'M-buried-signflip-bug',
    lang: 'ts', concept: 'buried-sign-error', complexity: 'complex', expected: 'reject',
    title: 'Apply discount then tax in computeTotal',
    description: 'A sign error is buried in an otherwise-correct large function: discount ADDS instead of subtracts.',
    blueprint: bp([
      'computeTotal applies the discount as a reduction: subtotal * (1 - discountRate)',
      'tax is applied after the discount',
    ]),
    base: {
      'src/cart.ts':
`export interface Line { sku: string; price: number; quantity: number; }

export function computeTotal(lines: Line[], discountRate: number, taxRate: number): number {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.price * line.quantity;
  }
  const discounted = subtotal;
  const taxed = discounted * (1 + taxRate);
  return Math.round(taxed * 100) / 100;
}
`,
    },
    // BUG: (1 + discountRate) INCREASES the total — sign flipped from the criterion.
    after: {
      'src/cart.ts':
`export interface Line { sku: string; price: number; quantity: number; }

export function computeTotal(lines: Line[], discountRate: number, taxRate: number): number {
  let subtotal = 0;
  for (const line of lines) {
    subtotal += line.price * line.quantity;
  }
  const discounted = subtotal * (1 + discountRate);
  const taxed = discounted * (1 + taxRate);
  return Math.round(taxed * 100) / 100;
}
`,
    },
  },
  {
    id: 'M-c-bounds-bug',
    lang: 'c', concept: 'off-by-one-buffer', complexity: 'complex', expected: 'reject',
    title: 'copy_prefix copies at most n bytes and NUL-terminates',
    description: 'Off-by-one: writes the NUL one past the buffer when the source is long.',
    blueprint: bp([
      'copy_prefix(dst, dstsize, src) copies up to dstsize-1 bytes then writes a NUL terminator within the buffer',
      'it never writes past dst[dstsize-1]',
    ]),
    base: {
      'copy.c':
`#include <string.h>

void copy_prefix(char *dst, size_t dstsize, const char *src) {
}
`,
    },
    // BUG: copies dstsize bytes then writes dst[dstsize] = 0 — one past the end.
    after: {
      'copy.c':
`#include <string.h>

void copy_prefix(char *dst, size_t dstsize, const char *src) {
    size_t i;
    for (i = 0; i < dstsize && src[i]; i++) {
        dst[i] = src[i];
    }
    dst[dstsize] = '\\0';
}
`,
    },
  },
  {
    id: 'M-yaml-wrong-key-bug',
    lang: 'yaml', concept: 'config-wrong-value', complexity: 'medium', expected: 'reject',
    title: 'CI must run tests on push to main',
    description: 'Blueprint requires the test job to trigger on push to main; impl triggers only on pull_request.',
    blueprint: bp([
      'the workflow triggers on push to the main branch',
      'the test job runs `npm test`',
    ]),
    base: { '.github/workflows/ci.yml': `name: ci\non: {}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo todo\n` },
    // BUG: triggers on pull_request only — the "push to main" criterion is UNMET.
    after: { '.github/workflows/ci.yml': `name: ci\non:\n  pull_request:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n` },
  },
];
