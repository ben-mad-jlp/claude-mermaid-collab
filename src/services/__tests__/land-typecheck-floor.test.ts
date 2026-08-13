import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runLandTypecheckFloor,
  landTypecheckRefuses,
  firstTypecheckError,
  LAND_TYPECHECK_ERROR_RE,
  type LandTypecheckProof,
} from '../land-typecheck-floor';
import type { GateSpawn } from '../leaf-gate';

/**
 * Create a temporary project root with an optional .collab/project.json.
 * Returns the project root path; caller must rmSync when done.
 */
function scratchProject(files?: { [path: string]: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'land-typecheck-floor-'));
  if (files) {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(dir, path);
      const dirPath = dirname(fullPath);
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  return dir;
}

test('exit 0 on the declared gate.typecheck command is pass', async () => {
  const projectRoot = scratchProject({
    '.collab/project.json': JSON.stringify({
      gate: { typecheck: 'echo "checking"' },
    }),
  });

  const spawn: GateSpawn = async () => ({
    ran: true,
    code: 0,
    output: 'checking\n',
  });

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(proof.status).toBe('pass');
  expect(proof.command).toBe('echo "checking"');
  expect(proof.exitCode).toBe(0);
  expect(proof.firstError).toBeNull();

  rmSync(projectRoot, { recursive: true, force: true });
});

test('non-zero exit reports fail with the first TS error line', async () => {
  const projectRoot = scratchProject({
    '.collab/project.json': JSON.stringify({
      gate: { typecheck: 'npx tsc --noEmit' },
    }),
  });

  const spawn: GateSpawn = async () => ({
    ran: true,
    code: 1,
    output: 'src/app.ts:42:15 - error TS2339: Property "foo" does not exist on type "Bar".\n',
  });

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(proof.status).toBe('fail');
  expect(proof.command).toBe('npx tsc --noEmit');
  expect(proof.exitCode).toBe(1);
  expect(proof.firstError).toContain('error TS2339');
  expect(landTypecheckRefuses(proof)).toBe(true);

  rmSync(projectRoot, { recursive: true, force: true });
});

test('spawn notFound with gate.typecheck declared is error, not pass', async () => {
  const projectRoot = scratchProject({
    '.collab/project.json': JSON.stringify({
      gate: { typecheck: 'npx tsc --noEmit' },
    }),
  });

  let spawnInvoked = false;
  const spawn: GateSpawn = async () => {
    spawnInvoked = true;
    // ran:false simulates spawn failure (ENOENT, signal, etc)
    return {
      ran: false,
      code: -1,
      output: 'command not found',
    };
  };

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(spawnInvoked).toBe(true);
  expect(proof.status).toBe('error');
  expect(proof.command).toBe('npx tsc --noEmit');
  expect(proof.firstError).toBe('typecheck command could not run');
  expect(landTypecheckRefuses(proof)).toBe(true);

  rmSync(projectRoot, { recursive: true, force: true });
});

test('a misconfigured manifest is error, never a pass', async () => {
  const projectRoot = scratchProject({
    '.collab/project.json': 'not valid json {]',
  });

  const spawn: GateSpawn = async () => ({
    ran: true,
    code: 0,
    output: '',
  });

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(proof.status).toBe('error');
  expect(proof.command).toBeNull();
  expect(proof.firstError).toContain('land gate misconfigured');

  rmSync(projectRoot, { recursive: true, force: true });
});

test('no tsconfig and no declared typecheck is not-applicable', async () => {
  // Create a project with NO .collab/project.json and NO tsconfig.json
  const projectRoot = mkdtempSync(join(tmpdir(), 'land-typecheck-floor-'));
  writeFileSync(join(projectRoot, 'README.md'), '# Project\n');

  const spawn: GateSpawn = async () => ({
    ran: true,
    code: 0,
    output: '',
  });

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(proof.status).toBe('not-applicable');
  expect(proof.command).toBeNull();
  expect(proof.exitCode).toBeNull();
  expect(proof.firstError).toBeNull();
  expect(proof.output).toBe('');
  expect(landTypecheckRefuses(proof)).toBe(false);

  rmSync(projectRoot, { recursive: true, force: true });
});

test('detectCompileCheck supplies the command when the manifest declares none', async () => {
  // Create a project with tsconfig.json but NO gate declaration
  const projectRoot = mkdtempSync(join(tmpdir(), 'land-typecheck-floor-'));
  writeFileSync(join(projectRoot, 'tsconfig.json'), '{}');
  writeFileSync(join(projectRoot, 'README.md'), '# Project\n');

  let spawnedCmd = '';
  const spawn: GateSpawn = async (_cwd, cmd) => {
    spawnedCmd = cmd;
    return {
      ran: true,
      code: 0,
      output: '',
    };
  };

  const proof = await runLandTypecheckFloor({
    repo: projectRoot,
    epicWorktreeCwd: projectRoot,
    spawn,
  });

  expect(proof.status).toBe('pass');
  expect(proof.command).toContain('tsc');
  expect(spawnedCmd).toContain('tsc');

  rmSync(projectRoot, { recursive: true, force: true });
});

test('firstTypecheckError extracts the error from TS output', () => {
  const output = `src/app.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.

10     x = "hello";
       ~
`;

  const error = firstTypecheckError(output);
  expect(error).toContain('error TS2322');
});

test('firstTypecheckError falls back to first non-empty line when no TS error', () => {
  const output = 'some error message\nmore details\n';

  const error = firstTypecheckError(output);
  expect(error).toBe('some error message');
});

test('firstTypecheckError returns null for empty output', () => {
  expect(firstTypecheckError('')).toBeNull();
  expect(firstTypecheckError('   \n  \n')).toBeNull();
});

test('LAND_TYPECHECK_ERROR_RE matches TS error codes', () => {
  expect('error TS2339: Property').toMatch(LAND_TYPECHECK_ERROR_RE);
  expect('error TS2551: Object').toMatch(LAND_TYPECHECK_ERROR_RE);
  expect('src/app.ts:1:1: error TS2345').toMatch(LAND_TYPECHECK_ERROR_RE);
});

test('LAND_TYPECHECK_ERROR_RE matches generic compiler errors', () => {
  expect('src/main.c:10:5: error : undefined symbol').toMatch(LAND_TYPECHECK_ERROR_RE);
  expect('src/file.go:10: error compilation failed').toMatch(LAND_TYPECHECK_ERROR_RE);
});
