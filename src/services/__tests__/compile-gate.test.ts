import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectCompileCheck } from '../compile-gate';

function scratch(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'compile-gate-'));
  for (const f of files) writeFileSync(join(dir, f), '');
  return dir;
}

test('tsconfig.json ⇒ tsc (unchanged prior behaviour)', () => {
  const d = scratch(['tsconfig.json']);
  expect(detectCompileCheck(d)?.cmd).toContain('tsc --noEmit');
  rmSync(d, { recursive: true, force: true });
});

test('.csproj ⇒ dotnet build', () => {
  const d = scratch(['App.csproj']);
  const c = detectCompileCheck(d);
  expect(c?.label).toBe('C#/.NET');
  expect(c?.cmd).toContain('dotnet build');
  rmSync(d, { recursive: true, force: true });
});

test('.sln ⇒ dotnet build', () => {
  const d = scratch(['Solution.sln']);
  expect(detectCompileCheck(d)?.cmd).toContain('dotnet build');
  rmSync(d, { recursive: true, force: true });
});

test('Python (pyproject only, no tsconfig/csproj) ⇒ null (no static compile gate)', () => {
  const d = scratch(['pyproject.toml', 'main.py']);
  expect(detectCompileCheck(d)).toBeNull();
  rmSync(d, { recursive: true, force: true });
});

test('tsconfig takes precedence over a stray csproj', () => {
  const d = scratch(['tsconfig.json', 'legacy.csproj']);
  expect(detectCompileCheck(d)?.label).toBe('TypeScript');
  rmSync(d, { recursive: true, force: true });
});

test('unreadable dir ⇒ fails SAFE to tsc (never null/skip)', () => {
  expect(detectCompileCheck('/no/such/dir/xyz')?.cmd).toContain('tsc --noEmit');
});
