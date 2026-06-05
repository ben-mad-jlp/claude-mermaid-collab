import { describe, it, expect } from 'vitest';
import {
  lintContent,
  lintFiles,
  isLintablePath,
  isLegacy,
  RETIRED_TERMS,
} from '../vocab-lint.ts';

// A path that is NOT on the legacy allowlist — represents new/changed clean code.
const NEW = 'src/services/new-feature.ts';

describe('vocab-lint — retired synonyms fail', () => {
  it('flags "pool session" → worker', () => {
    const v = lintContent('// the pool session was killed', NEW);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('pool-session');
    expect(v[0].canonical).toBe('worker');
    expect(v[0].line).toBe(1);
  });

  it('flags "lane" (and "lanes") → worker', () => {
    expect(lintContent('const lane = spawn();', NEW)).toHaveLength(1);
    expect(lintContent('reap dead lanes', NEW)[0].canonical).toBe('worker');
  });

  it('flags "pool-type" and camelCase "poolType" → type', () => {
    expect(lintContent('the pool-type routing key', NEW)[0].canonical).toBe('type');
    const camel = lintContent('let poolType = todo.type;', NEW);
    expect(camel).toHaveLength(1);
    expect(camel[0].rule).toBe('pool-type');
  });

  it('flags "collab session" → workspace', () => {
    const v = lintContent('resume the collab session', NEW);
    expect(v[0].canonical).toBe('workspace');
  });

  it('reports line and column for the match', () => {
    const v = lintContent('ok\n  here is a lane today', NEW);
    expect(v[0].line).toBe(2);
    expect(v[0].column).toBe('  here is a '.length + 1);
  });

  it('flags multiple matches on one line', () => {
    const v = lintContent('lane and another lane', NEW);
    expect(v).toHaveLength(2);
  });
});

describe('vocab-lint — canonical terms pass', () => {
  it('does not flag the canonical vocabulary', () => {
    const canonical =
      'A worker runs in a slot of a pool; its type picks the pool. ' +
      'A session runs against a workspace. The profile is the composed identity.';
    expect(lintContent(canonical, NEW)).toEqual([]);
  });

  it('does not false-match "plane", "clean", or "type" alone', () => {
    expect(lintContent('the plane is clean; set the type field', NEW)).toEqual([]);
  });

  it('does not match "worker" or "workspace" (the replacements)', () => {
    expect(lintContent('worker workspace worker-pool', NEW)).toEqual([]);
  });
});

describe('vocab-lint — legacy and suppression are not flagged', () => {
  it('skips legacy-allowlisted files entirely', () => {
    expect(isLegacy('src/services/worker-pool.ts')).toBe(true);
    expect(lintContent('const lane = 1; // poolType pool session', 'src/services/worker-pool.ts')).toEqual([]);
  });

  it('honors a same-line ignore', () => {
    expect(lintContent('const lane = 1; // vocab-lint-ignore-line', NEW)).toEqual([]);
  });

  it('honors an ignore-next-line', () => {
    expect(lintContent('// vocab-lint-ignore-next-line\nconst lane = 1;', NEW)).toEqual([]);
  });

  it('honors a file-level disable', () => {
    expect(lintContent('/* vocab-lint-disable-file */\nconst lane = 1;\nlet poolType;', NEW)).toEqual([]);
  });
});

describe('vocab-lint — file scoping', () => {
  it('isLintablePath: scans code/docs, skips legacy and non-source', () => {
    expect(isLintablePath(NEW)).toBe(true);
    expect(isLintablePath('docs/guide.md')).toBe(true);
    expect(isLintablePath('src/services/worker-pool.ts')).toBe(false); // legacy
    expect(isLintablePath('image.png')).toBe(false);
    expect(isLintablePath('Makefile')).toBe(false);
  });

  it('lintFiles aggregates across files and skips unreadable/legacy', () => {
    const read = (f: string): string | null => {
      if (f === NEW) return 'const lane = 1;';
      if (f === 'src/services/worker-pool.ts') return 'const lane = 2;'; // legacy → skipped
      return null; // unreadable → skipped
    };
    const v = lintFiles([NEW, 'src/services/worker-pool.ts', 'missing.ts', 'logo.svg'], read);
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe(NEW);
  });
});

describe('vocab-lint — rule table integrity', () => {
  it('every rule has a global, case-insensitive pattern', () => {
    for (const t of RETIRED_TERMS) {
      expect(t.pattern.flags).toContain('g');
      expect(t.pattern.flags).toContain('i');
      expect(t.canonical).toBeTruthy();
    }
  });
});
