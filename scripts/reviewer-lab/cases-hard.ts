/**
 * HARD corpus — adversarial cases aimed at the reviewer's known failure boundaries:
 *   over-rejection of CORRECT code (the historical daemon problem), and misses of SUBTLE bugs.
 * Same shape as ./cases.ts.
 */
import type { Case } from './cases';

const bp = (criteria: string[], prose = ''): string =>
  `${prose ? prose + '\n\n' : ''}ACCEPTANCE CRITERIA:\n${criteria.map((c) => `- ${c}`).join('\n')}`;

export const HARD: Case[] = [
  // ───────── OVER-REJECTION TRAPS (correct code — reviewer must ACCEPT) ─────────
  {
    id: 'H-absence-criterion-ok',
    lang: 'ts', concept: 'absence-criterion', complexity: 'medium', expected: 'accept',
    title: 'Add caching to resolve() without a new dependency',
    description: 'Memoize resolve(). A criterion is phrased as an absence — the reviewer must mark it [N/A], not strand the leaf.',
    blueprint: bp([
      'resolve(key) memoizes results in a module-level Map',
      'no new npm dependency is added (package.json unchanged)',
      'the public signature of resolve is unchanged',
    ]),
    base: {
      'src/resolve.ts':
`export function resolve(key: string): number {
  return key.length * 7;
}
`,
      'package.json': `{\n  "name": "demo",\n  "dependencies": {}\n}\n`,
    },
    after: {
      'src/resolve.ts':
`const cache = new Map<string, number>();

export function resolve(key: string): number {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = key.length * 7;
  cache.set(key, v);
  return v;
}
`,
      // package.json intentionally untouched
    },
  },
  {
    id: 'H-command-result-criterion-ok',
    lang: 'ts', concept: 'command-result-criterion', complexity: 'simple', expected: 'accept',
    title: 'Fix the failing type export',
    description: 'A criterion is stated as a command outcome ("tsc clean") — must defer to evidence, not vacuous-reject.',
    blueprint: bp([
      'Point type is exported from src/geo.ts',
      'tsc --noEmit passes with no errors',
    ]),
    base: {
      'src/geo.ts':
`interface Point { x: number; y: number; }
export const origin: Point = { x: 0, y: 0 };
`,
    },
    after: {
      'src/geo.ts':
`export interface Point { x: number; y: number; }
export const origin: Point = { x: 0, y: 0 };
`,
    },
  },
  {
    id: 'H-alt-approach-ok',
    lang: 'python', concept: 'valid-alternate-approach', complexity: 'medium', expected: 'accept',
    title: 'Dedupe while preserving order',
    description: 'Blueprint implies a set+loop; impl uses dict.fromkeys — a different but fully correct approach.',
    blueprint: bp([
      'dedupe(xs) returns xs with duplicates removed, first occurrence kept',
      'original input order is preserved',
    ], 'HINT: iterate and track a seen set.'),
    base: { 'dedupe.py': `def dedupe(xs):\n    return xs\n` },
    // Different implementation than the hint, but correct (dict preserves insertion order in 3.7+).
    after: { 'dedupe.py': `def dedupe(xs):\n    return list(dict.fromkeys(xs))\n` },
  },
  {
    id: 'H-deletion-leaf-ok',
    lang: 'ts', concept: 'deletion-leaf', complexity: 'medium', expected: 'accept',
    title: 'Remove the deprecated legacyParse export',
    description: 'Delete legacyParse and its only caller path. Deletions are hard to cite — reviewer must not strand.',
    blueprint: bp([
      'legacyParse is removed from src/parse.ts',
      'parse() no longer falls back to legacyParse',
    ]),
    base: {
      'src/parse.ts':
`export function legacyParse(s: string): number {
  return parseInt(s, 8);
}

export function parse(s: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) return legacyParse(s);
  return n;
}
`,
    },
    after: {
      'src/parse.ts':
`export function parse(s: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  return n;
}
`,
    },
  },
  {
    id: 'H-multifile-coordinated-ok',
    lang: 'ts', concept: 'multifile-coordinated', complexity: 'complex', expected: 'accept',
    title: 'Thread a maxRetries option through the client',
    description: 'A correct 2-file coordinated change (type + call site). The same-wall over-rejection class.',
    blueprint: bp([
      'ClientOptions gains a maxRetries?: number field',
      'createClient passes options.maxRetries into RetryPolicy, defaulting to 3',
      'RetryPolicy.attempts equals the passed value',
    ]),
    base: {
      'src/options.ts': `export interface ClientOptions {\n  baseUrl: string;\n}\n`,
      'src/client.ts':
`import { ClientOptions } from './options';

export class RetryPolicy {
  constructor(public attempts: number) {}
}

export function createClient(options: ClientOptions) {
  const policy = new RetryPolicy(3);
  return { options, policy };
}
`,
    },
    after: {
      'src/options.ts': `export interface ClientOptions {\n  baseUrl: string;\n  maxRetries?: number;\n}\n`,
      'src/client.ts':
`import { ClientOptions } from './options';

export class RetryPolicy {
  constructor(public attempts: number) {}
}

export function createClient(options: ClientOptions) {
  const policy = new RetryPolicy(options.maxRetries ?? 3);
  return { options, policy };
}
`,
    },
  },
  {
    id: 'H-boundary-inclusive-ok',
    lang: 'go', concept: 'boundary-correct', complexity: 'medium', expected: 'accept',
    title: 'Clamp must be inclusive on both ends',
    description: 'Correct inclusive clamp. A twitchy reviewer may misread the boundary as off-by-one.',
    blueprint: bp([
      'Clamp(v, lo, hi) returns lo when v < lo and hi when v > hi',
      'a value equal to lo or hi is returned unchanged (inclusive bounds)',
    ]),
    base: { 'clamp.go': `package m

func Clamp(v, lo, hi int) int {
	return v
}
` },
    after: { 'clamp.go': `package m

func Clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
` },
  },

  // ───────── UNDER-REJECTION TRAPS (subtle real bugs — reviewer must REJECT) ─────────
  {
    id: 'H-missing-await-bug',
    lang: 'ts', concept: 'missing-await', complexity: 'complex', expected: 'reject',
    title: 'Persist then return the saved row',
    description: 'save() must await the write before returning. Missing await → returns before persistence.',
    blueprint: bp([
      'save(row) awaits db.write(row) before returning',
      'save returns the written row',
    ]),
    base: {
      'src/save.ts':
`interface Db { write(row: object): Promise<void>; }
export async function save(db: Db, row: object) {
  return row;
}
`,
    },
    // BUG: db.write is called but not awaited — the row may return before the write commits.
    after: {
      'src/save.ts':
`interface Db { write(row: object): Promise<void>; }
export async function save(db: Db, row: object) {
  db.write(row);
  return row;
}
`,
    },
  },
  {
    id: 'H-boundary-exclusive-bug',
    lang: 'python', concept: 'boundary-off-by-one', complexity: 'complex', expected: 'reject',
    title: 'Allow ages 18 and up',
    description: 'is_adult must be true for age >= 18. Impl uses > 18, excluding exactly 18.',
    blueprint: bp([
      'is_adult(age) returns True for age >= 18',
      'is_adult(18) is True',
    ]),
    base: { 'age.py': `def is_adult(age):\n    return False\n` },
    // BUG: strict > excludes the boundary the blueprint explicitly names (18).
    after: { 'age.py': `def is_adult(age):\n    return age > 18\n` },
  },
  {
    id: 'H-resource-leak-bug',
    lang: 'python', concept: 'resource-leak', complexity: 'complex', expected: 'reject',
    title: 'Read the file and return its size, always closing the handle',
    description: 'Must close the handle even on the early-return path.',
    blueprint: bp([
      'file_size(path) returns the byte length of the file contents',
      'the file handle is always closed, including on the empty-file early return',
    ]),
    base: { 'fsz.py': `def file_size(path):\n    return 0\n` },
    // BUG: early return on empty leaks the handle (f never closed on that path).
    after: { 'fsz.py': `def file_size(path):\n    f = open(path)\n    data = f.read()\n    if data == '':\n        return 0\n    f.close()\n    return len(data)\n` },
  },
  {
    id: 'H-injection-bug',
    lang: 'ts', concept: 'sql-injection', complexity: 'complex', expected: 'reject',
    title: 'Look up a user by name using a parameterized query',
    description: 'Blueprint requires parameterized query; impl interpolates raw input (injection).',
    blueprint: bp([
      'findByName issues a query filtered by the given name',
      'the name is passed as a bound parameter, never string-interpolated into the SQL',
    ]),
    base: {
      'src/repo.ts':
`interface Conn { query(sql: string, params?: unknown[]): Promise<unknown>; }
export function findByName(conn: Conn, name: string) {
  return conn.query('SELECT 1');
}
`,
    },
    // BUG: interpolates name directly into the SQL string — classic injection, violates the criterion.
    after: {
      'src/repo.ts':
`interface Conn { query(sql: string, params?: unknown[]): Promise<unknown>; }
export function findByName(conn: Conn, name: string) {
  return conn.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
}
`,
    },
  },
  {
    id: 'H-wrong-default-bug',
    lang: 'js', concept: 'silent-wrong-default', complexity: 'complex', expected: 'reject',
    title: 'parsePort defaults to 8080',
    description: 'Missing/invalid input must default to 8080; impl defaults to 80.',
    blueprint: bp([
      'parsePort(s) returns the integer value of s when it is a valid port',
      'parsePort returns 8080 when s is undefined or not a number',
    ]),
    base: { 'port.js': `function parsePort(s) {\n  return 0;\n}\nmodule.exports = { parsePort };\n` },
    // BUG: defaults to 80, not the 8080 the criterion names — passes casual eyeballing.
    after: { 'port.js': `function parsePort(s) {\n  const n = parseInt(s, 10);\n  return Number.isNaN(n) ? 80 : n;\n}\nmodule.exports = { parsePort };\n` },
  },
  {
    id: 'H-mutation-aliasing-bug',
    lang: 'python', concept: 'shared-mutable-default', complexity: 'complex', expected: 'reject',
    title: 'append_item returns a new list per call',
    description: 'Mutable default arg aliases state across calls — a real bug the blueprint forbids.',
    blueprint: bp([
      'append_item(x, acc=None) appends x to acc and returns it',
      'calling append_item repeatedly without acc does NOT accumulate across calls (no shared state)',
    ]),
    base: { 'acc.py': `def append_item(x, acc=None):\n    return [x]\n` },
    // BUG: mutable default [] is shared across calls — the exact anti-pattern the 2nd criterion bans.
    after: { 'acc.py': `def append_item(x, acc=[]):\n    acc.append(x)\n    return acc\n` },
  },
];
