import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'bun';
import { runQuarantinedSpec, quarantineSuiteIdentities } from '../quarantine-runner';
import { loadProjectManifest } from '../../config/project-manifest';
import { defaultGateSpawn } from '../leaf-gate';

/**
 * Test quarantine runner behavior with git repos and actual quarantine specs.
 */
describe('quarantine-runner', () => {
  let testRepoDir: string;

  beforeEach(() => {
    testRepoDir = join(import.meta.dir, '../../..', `.test-quarantine-runner-${Date.now()}`);
    mkdirSync(testRepoDir, { recursive: true });

    // Initialize a git repo
    spawnSync(['git', 'init'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'config', 'user.name', 'Test User'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    // Create minimal project structure with .collab/project.json gate config
    mkdirSync(join(testRepoDir, '.collab'), { recursive: true });

    // Create a simple gate config: a per-file bun test lane
    const projectJson = {
      gate: {
        test: 'bun test {file}',
      },
    };
    writeFileSync(
      join(testRepoDir, '.collab', 'project.json'),
      JSON.stringify(projectJson, null, 2),
    );
  });

  afterEach(() => {
    try {
      rmSync(testRepoDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('reports red:true for a committed red quarantined spec', async () => {
    // Create a failing quarantined spec
    const specPath = '__quarantine__/test-red.test.ts';
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    const specContent = `
import { describe, it, expect } from 'bun:test';

describe('quarantined red test', () => {
  it('is red', () => {
    expect(true).toBe(false);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath), specContent);

    // Commit the spec
    spawnSync(['git', 'add', specPath], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add red quarantine spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const result = await runQuarantinedSpec(testRepoDir, specPath);

    expect(result.ran).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.quarantined).toBe(true);
    expect(result.red).toBe(true);
    expect(result.failureIdentity).not.toBeNull();
  });

  it('reports red:false for a committed green quarantined spec', async () => {
    // Create a passing quarantined spec
    const specPath = '__quarantine__/test-green.test.ts';
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    const specContent = `
import { describe, it, expect } from 'bun:test';

describe('quarantined green test', () => {
  it('is green', () => {
    expect(true).toBe(true);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath), specContent);

    // Commit the spec
    spawnSync(['git', 'add', specPath], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add green quarantine spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const result = await runQuarantinedSpec(testRepoDir, specPath);

    expect(result.ran).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.quarantined).toBe(true);
    expect(result.red).toBe(false);
    expect(result.failureIdentity).toBeNull();
  });

  it('reports ran:false and committed:false for an uncommitted path', async () => {
    // Create a file but don't commit it
    const specPath = '__quarantine__/test-uncommitted.test.ts';
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    const specContent = `
import { describe, it, expect } from 'bun:test';

describe('test', () => {
  it('works', () => {
    expect(true).toBe(true);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath), specContent);

    const result = await runQuarantinedSpec(testRepoDir, specPath);

    expect(result.ran).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.quarantined).toBe(true);
  });

  it('reports quarantined:false for a path outside __quarantine__', async () => {
    const specPath = 'regular-test.test.ts';
    const specContent = `
import { describe, it, expect } from 'bun:test';

describe('regular test', () => {
  it('works', () => {
    expect(true).toBe(true);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath), specContent);

    // Commit the spec
    spawnSync(['git', 'add', specPath], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add regular spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const result = await runQuarantinedSpec(testRepoDir, specPath);

    expect(result.ran).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.quarantined).toBe(false);
  });

  it('renaming the red spec within quarantine yields the same failureIdentity', async () => {
    // Create and commit a red quarantined spec
    const specPath1 = '__quarantine__/test-original.test.ts';
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    const specContent = `
import { describe, it, expect } from 'bun:test';

describe('quarantined red test', () => {
  it('is red', () => {
    expect(true).toBe(false);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath1), specContent);
    spawnSync(['git', 'add', specPath1], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add red quarantine spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const result1 = await runQuarantinedSpec(testRepoDir, specPath1);
    expect(result1.red).toBe(true);
    const identity1 = result1.failureIdentity;
    expect(identity1).not.toBeNull();

    // Rename the spec within quarantine
    const specPath2 = '__quarantine__/test-renamed.test.ts';
    const content = readFileSync(join(testRepoDir, specPath1), 'utf-8');
    writeFileSync(join(testRepoDir, specPath2), content);
    spawnSync(['git', 'rm', specPath1], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'add', specPath2], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'rename red quarantine spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const result2 = await runQuarantinedSpec(testRepoDir, specPath2);
    expect(result2.red).toBe(true);
    const identity2 = result2.failureIdentity;
    expect(identity2).not.toBeNull();

    // The identity should remain the same
    expect(identity2).toBe(identity1);
  });

  it('quarantineSuiteIdentities builds map for all red quarantined specs', async () => {
    // Create and commit multiple specs
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    // Red spec 1
    writeFileSync(
      join(testRepoDir, '__quarantine__/red1.test.ts'),
      `
import { describe, it, expect } from 'bun:test';
describe('test', () => {
  it('fails', () => { expect(true).toBe(false); });
});
`,
    );

    // Green spec (should not be in the map)
    writeFileSync(
      join(testRepoDir, '__quarantine__/green.test.ts'),
      `
import { describe, it, expect } from 'bun:test';
describe('test', () => {
  it('passes', () => { expect(true).toBe(true); });
});
`,
    );

    // Red spec 2
    writeFileSync(
      join(testRepoDir, '__quarantine__/red2.test.ts'),
      `
import { describe, it, expect } from 'bun:test';
describe('test', () => {
  it('fails', () => { expect(1).toBe(2); });
});
`,
    );

    spawnSync(['git', 'add', '.'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add quarantine specs'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    const identities = await quarantineSuiteIdentities(testRepoDir);

    // The map should contain red specs but not green ones
    expect(identities.size).toBeGreaterThan(0);
    expect(identities.has('__quarantine__/red1.test.ts')).toBe(true);
    expect(identities.has('__quarantine__/red2.test.ts')).toBe(true);
    // Green spec should only be in the map if it has a failureIdentity
    // (in this case, it shouldn't because it passes)
    const greenIdentity = identities.get('__quarantine__/green.test.ts');
    if (greenIdentity !== undefined) {
      // If it's in the map, something is wrong
      expect(greenIdentity).toBeNull();
    }
  });

  it('vitest-shaped FAIL-line identity survives a rename of the quarantined spec', async () => {
    // Set up a vitest-shaped gate config
    const viestProjectJson = {
      gate: {
        test: 'vitest run {file}',
      },
    };
    writeFileSync(
      join(testRepoDir, '.collab', 'project.json'),
      JSON.stringify(viestProjectJson, null, 2),
    );

    // Create a quarantined spec
    const specPath1 = '__quarantine__/vitest-red.spec.ts';
    mkdirSync(join(testRepoDir, '__quarantine__'), { recursive: true });

    const specContent = `
import { describe, it, expect } from 'vitest';

describe('vitest quarantined red test', () => {
  it('is red', () => {
    expect(true).toBe(false);
  });
});
`;

    writeFileSync(join(testRepoDir, specPath1), specContent);
    spawnSync(['git', 'add', specPath1], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'add vitest red quarantine spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    // Mock spawn: pass through git ls-tree calls via defaultGateSpawn, but return vitest-style FAIL output for test commands
    const mockSpawn = async (cwd: string, cmd: string) => {
      if (cmd.includes('git ls-tree')) {
        // Use the real defaultGateSpawn for git commands
        return defaultGateSpawn(cwd, cmd);
      }

      // For vitest test commands, return a mock failure
      if (cmd.includes('vitest')) {
        // Get the current spec path from git
        const lsResult = await defaultGateSpawn(cwd, 'git ls-tree -r --name-only HEAD');
        const lines = lsResult.output.split('\n');
        const currentSpecPath = lines.find((line) => line.includes('vitest-red') || line.includes('vitest-renamed'));

        return {
          ran: true,
          code: 1,
          output: currentSpecPath
            ? `FAIL ${currentSpecPath}\n  × assertion failed\n`
            : 'FAIL __quarantine__/vitest-red.spec.ts\n  × assertion failed\n',
        };
      }

      return { ran: false, code: 1, output: '' };
    };

    // Get the identity before rename
    const result1 = await runQuarantinedSpec(testRepoDir, specPath1, { spawn: mockSpawn });
    expect(result1.red).toBe(true);
    const identity1 = result1.failureIdentity;
    expect(identity1).not.toBeNull();
    expect(identity1).not.toInclude('vitest-red');
    expect(identity1).not.toInclude('__quarantine__');
    expect(identity1).not.toInclude('.spec.ts');

    // Rename the spec
    const specPath2 = '__quarantine__/vitest-renamed.spec.ts';
    const content = readFileSync(join(testRepoDir, specPath1), 'utf-8');
    writeFileSync(join(testRepoDir, specPath2), content);
    spawnSync(['git', 'rm', specPath1], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'add', specPath2], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });
    spawnSync(['git', 'commit', '-m', 'rename vitest spec'], { cwd: testRepoDir, stdout: 'ignore', stderr: 'ignore' });

    // Get the identity after rename
    const result2 = await runQuarantinedSpec(testRepoDir, specPath2, { spawn: mockSpawn });
    expect(result2.red).toBe(true);
    const identity2 = result2.failureIdentity;
    expect(identity2).not.toBeNull();
    expect(identity2).not.toInclude('vitest-renamed');
    expect(identity2).not.toInclude('__quarantine__');
    expect(identity2).not.toInclude('.spec.ts');

    // The identities should be the same
    expect(identity2).toBe(identity1);
  });
});
