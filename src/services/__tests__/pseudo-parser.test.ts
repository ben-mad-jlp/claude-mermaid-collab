import { describe, it, expect } from 'bun:test';
import { parsePseudo } from '../pseudo-parser';

describe('parsePseudo header', () => {
  it('parses title, purpose, and syncedAt from // comment headers', () => {
    const content = [
      '// My File',
      '// Does things',
      '// synced: 2026-04-09T12:00:00Z',
      '',
      'FUNCTION foo()',
      '  1. Do something',
    ].join('\n');
    const result = parsePseudo(content);
    expect(result.title).toBe('My File');
    expect(result.purpose).toBe('Does things');
    expect(result.syncedAt).toBe('2026-04-09T12:00:00Z');
  });

  it('parses source: header into sourceFilePath', () => {
    const content = [
      '// Title',
      '// Purpose',
      '// synced: 2026-04-09T12:00:00Z',
      '// source: src/services/foo.ts',
      '',
      'FUNCTION foo()',
      '  1. Step',
    ].join('\n');
    const result = parsePseudo(content);
    expect(result.sourceFilePath).toBe('src/services/foo.ts');
  });

  it('parses language: header into language', () => {
    const content = [
      '// T',
      '// P',
      '// synced: 2026-04-09T12:00:00Z',
      '// language: typescript',
      '',
      'FUNCTION foo()',
      '  1. Step',
    ].join('\n');
    const result = parsePseudo(content);
    expect(result.language).toBe('typescript');
  });

  it('returns null sourceFilePath/language when markers absent', () => {
    const content = [
      '// T',
      '// P',
      '// synced: 2026-04-09T12:00:00Z',
      '',
      'FUNCTION foo()',
      '  1. Step',
    ].join('\n');
    const result = parsePseudo(content);
    expect(result.sourceFilePath).toBeNull();
    expect(result.language).toBeNull();
  });

  it('handles empty content', () => {
    const result = parsePseudo('');
    expect(result.title).toBe('');
    expect(result.methods).toHaveLength(0);
    expect(result.sourceFilePath).toBeNull();
    expect(result.language).toBeNull();
  });
});

describe('parseFunctionHeader tokeniser', () => {
  it('parses simple function with no params and no return type', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo()\n  1. Do');
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].name).toBe('foo');
    expect(result.methods[0].params).toBe('');
    expect(result.methods[0].returnType).toBe('');
  });

  it('parses function with one param', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo(x: number) -> string\n  1. Do');
    expect(result.methods[0].name).toBe('foo');
    expect(result.methods[0].params).toBe('x: number');
    expect(result.methods[0].returnType).toBe('string');
  });

  it('parses function with three comma-separated params', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION bar(a: number, b: string, c: boolean)\n  1. Do');
    expect(result.methods[0].params).toBe('a: number, b: string, c: boolean');
    expect(result.methods[0].paramCount).toBe(3);
  });

  it('parses nested parens in params (callback types)', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION map(cb: (x: T) => U) -> U[]\n  1. Do');
    expect(result.methods[0].name).toBe('map');
    expect(result.methods[0].params).toBe('cb: (x: T) => U');
    expect(result.methods[0].returnType).toBe('U[]');
  });

  it('parses EXPORT without date', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo() -> void   EXPORT\n  1. Do');
    expect(result.methods[0].isExport).toBe(true);
    expect(result.methods[0].date).toBeNull();
  });

  it('parses EXPORT with [YYYY-MM-DD] date', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo() -> void   EXPORT [2026-04-09]\n  1. Do');
    expect(result.methods[0].isExport).toBe(true);
    expect(result.methods[0].date).toBe('2026-04-09');
  });

  it('parses [YYYY-MM-DD] date without EXPORT', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo() -> void   [2026-04-09]\n  1. Do');
    expect(result.methods[0].isExport).toBe(false);
    expect(result.methods[0].date).toBe('2026-04-09');
  });

  it('parses dotted identifier Foo.bar as method name', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION UserService.login(email)\n  1. Do');
    expect(result.methods[0].name).toBe('UserService.login');
    expect(result.methods[0].owningSymbol).toBe('UserService');
  });

  it('produces empty methods for malformed FUNCTION lines', () => {
    // No identifier after FUNCTION
    const result = parsePseudo('// t\n// p\nFUNCTION \n  1. Do');
    expect(result.methods).toHaveLength(0);
  });
});

describe('parseMethodMetadata', () => {
  it('parses VISIBILITY: public into visibility field', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  VISIBILITY: public',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].visibility).toBe('public');
  });

  it('parses VISIBILITY private/protected/internal', () => {
    for (const v of ['private', 'protected', 'internal'] as const) {
      const result = parsePseudo([
        '// t', '// p',
        'FUNCTION foo()',
        `  VISIBILITY: ${v}`,
        '  1. Do',
      ].join('\n'));
      expect(result.methods[0].visibility).toBe(v);
    }
  });

  it('sets visibility=null for unknown VISIBILITY values', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  VISIBILITY: weird',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].visibility).toBeNull();
  });

  it('parses ASYNC: true into isAsync=true', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  ASYNC: true',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].isAsync).toBe(true);
  });

  it('parses ASYNC: false into isAsync=false', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  ASYNC: false',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].isAsync).toBe(false);
  });

  it('parses KIND: method into kind field', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  KIND: method',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].kind).toBe('method');
  });

  it('validates KIND against allowed values', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  KIND: wacko',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].kind).toBeNull();
  });

  it('ignores unknown metadata markers like FOO:', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  FOO: bar',
      '  1. Do',
    ].join('\n'));
    // Should not crash and should not treat FOO as a step
    expect(result.methods[0].stepCount).toBe(1);
  });

  it('does not interfere with CALLS: parsing', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  VISIBILITY: public',
      '  CALLS: bar (utils)',
      '  1. Do',
    ].join('\n'));
    expect(result.methods[0].visibility).toBe('public');
    expect(result.methods[0].calls).toHaveLength(1);
    expect(result.methods[0].calls[0].name).toBe('bar');
  });
});

describe('derived fields', () => {
  it('paramCount = 0 for empty params', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo()\n  1. Do');
    expect(result.methods[0].paramCount).toBe(0);
  });

  it('paramCount = 1 for one param', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo(x)\n  1. Do');
    expect(result.methods[0].paramCount).toBe(1);
  });

  it('paramCount = 3 for three params', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION foo(a, b, c)\n  1. Do');
    expect(result.methods[0].paramCount).toBe(3);
  });

  it('stepCount reflects the number of steps', () => {
    const result = parsePseudo([
      '// t', '// p',
      'FUNCTION foo()',
      '  1. First',
      '  2. Second',
      '  3. Third',
    ].join('\n'));
    expect(result.methods[0].stepCount).toBe(3);
  });

  it('owningSymbol = Foo for name Foo.bar', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION Foo.bar()\n  1. Do');
    expect(result.methods[0].owningSymbol).toBe('Foo');
  });

  it('owningSymbol = null for bare name', () => {
    const result = parsePseudo('// t\n// p\nFUNCTION bare()\n  1. Do');
    expect(result.methods[0].owningSymbol).toBeNull();
  });
});

describe('backward compatibility', () => {
  it('parses a legacy file with no new markers', () => {
    const content = [
      '// Auth service',
      '// Handles login.',
      '// synced: 2026-03-26T14:30:00Z',
      '',
      'Some prose about auth.',
      '',
      'FUNCTION login(email, password) -> AuthResult                 EXPORT [2026-03-26]',
      '  CALLS: hashPassword (crypto)',
      '  1. Look up user.',
      '  2. Verify password.',
      '',
      '---',
      '',
      'FUNCTION logout() -> void                                     EXPORT [2026-03-20]',
      '  1. Clear cookie.',
    ].join('\n');
    const result = parsePseudo(content);
    expect(result.title).toBe('Auth service');
    expect(result.purpose).toBe('Handles login.');
    expect(result.syncedAt).toBe('2026-03-26T14:30:00Z');
    expect(result.sourceFilePath).toBeNull();
    expect(result.language).toBeNull();
    expect(result.methods).toHaveLength(2);
    expect(result.methods[0].name).toBe('login');
    expect(result.methods[0].isExport).toBe(true);
    expect(result.methods[0].visibility).toBeNull();
    expect(result.methods[0].isAsync).toBe(false);
    expect(result.methods[0].kind).toBeNull();
    expect(result.methods[0].calls).toHaveLength(1);
    expect(result.methods[1].name).toBe('logout');
  });
});
