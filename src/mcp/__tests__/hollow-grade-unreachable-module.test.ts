/**
 * Guard enforcement: module reachability scanner prevents grading met=true when
 * a serving epic has landed source modules with no non-test importers.
 *
 * Patterns:
 * - Store isolation + live-handler from criterion-verify-panel-enforcement.test.ts
 * - Real git repo setup from adopt-branch-as-epic.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMissionTool } from '../mission-tools';
import { createTodo, _closeProject } from '../../services/todo-store';
import { addCriterion, listCriteria } from '../../services/mission-store';
import { _closeDb } from '../../services/supervisor-store';
import { recordEpicLand } from '../../services/epic-land-record-store';

const S = 's_test';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'hollow-grade-unreachable-'));
  // Isolate supervisor.db by using the project dir
  process.env.MERMAID_SUPERVISOR_DIR = project;

  // Initialize a real git repo
  execFileSync('git', ['init'], { cwd: project });
  // Force the default branch name to master (git init's default is not guaranteed)
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: project });

  // Setup git user for commits
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: project });
});

afterEach(() => {
  _closeProject(project);
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function callMissionTool(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleMissionTool(name, { project, ...args });
  return JSON.parse(out!);
}

/**
 * Shared setup: create mission, criterion, and epic serving that criterion.
 * Returns { mission, criterion, epic, masterSha }.
 */
async function setupMissionAndEpic(title: string) {
  // Create .gitignore to exclude .collab/ and node_modules
  writeFileSync(join(project, '.gitignore'), `.collab/\nnode_modules/\n`);

  // Initial master commit
  writeFileSync(join(project, 'initial.txt'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: project });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: project });
  const masterSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
    .toString('utf8')
    .trim();

  const mission = await createTodo(project, {
    allowOrphan: true,
    ownerSession: S,
    title: `[MISSION] ${title}`,
    kind: 'mission',
  });

  const criterion = addCriterion(project, mission.id, 'Test criterion');

  const epic = await createTodo(project, {
    allowOrphan: true,
    ownerSession: S,
    title: `[EPIC] ${title}`,
    kind: 'epic',
    servesCriterionId: criterion.id,
  });

  return { mission, criterion, epic, masterSha };
}

describe('hollow-grade-unreachable-module', () => {
  test('case A: refuses met=true grading and the message cites the unreachable module path', async () => {
    const { mission, criterion, epic, masterSha } = await setupMissionAndEpic('Case A');

    // Commit a new unreachable module (no test importers)
    mkdirSync(join(project, 'src', 'services'), { recursive: true });
    writeFileSync(join(project, 'src', 'services', 'unreachable-test-module.ts'), `
export function testExport() {
  return 'test';
}
`);

    // Also commit a test file for the module (doesn't count as production importer)
    mkdirSync(join(project, 'src', 'services', '__tests__'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'services', '__tests__', 'unreachable-test-module.test.ts'),
      `
import { testExport } from '../unreachable-test-module';
describe('unreachable', () => {
  test('works', () => {
    expect(testExport()).toBe('test');
  });
});
`
    );

    execFileSync('git', ['add', '.'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add unreachable module'], { cwd: project });

    const landSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Record the epic land
    recordEpicLand(project, {
      epicId: epic.id,
      epicTipSha: landSha,
      landedMergeSha: landSha,
      landedAt: Date.now(),
    });

    // Attempt to grade met=true — should reject with module path in error message
    let error: Error | null = null;
    try {
      await callMissionTool('set_mission_criterion', {
        criterionId: criterion.id,
        met: true,
        evidence: 'test evidence',
        verifiedBy: 'test',
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/src\/services\/unreachable-test-module\.ts/);

    // Verify the store write never happened: criterion.met should still be false
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
  });

  test('case B: adding a production call site makes the same criterion grade met=true', async () => {
    const { mission, criterion, epic, masterSha } = await setupMissionAndEpic('Case B');

    // Commit the unreachable module
    mkdirSync(join(project, 'src', 'services'), { recursive: true });
    writeFileSync(join(project, 'src', 'services', 'unreachable-test-module.ts'), `
export function testExport() {
  return 'test';
}
`);

    mkdirSync(join(project, 'src', 'services', '__tests__'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'services', '__tests__', 'unreachable-test-module.test.ts'),
      `
import { testExport } from '../unreachable-test-module';
describe('unreachable', () => {
  test('works', () => {
    expect(testExport()).toBe('test');
  });
});
`
    );

    execFileSync('git', ['add', '.'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add unreachable module'], { cwd: project });

    const landSha1 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Record the first land (with unreachable module)
    recordEpicLand(project, {
      epicId: epic.id,
      epicTipSha: landSha1,
      landedMergeSha: landSha1,
      landedAt: Date.now(),
    });

    // Verify that met=true is rejected at this point
    let error1: Error | null = null;
    try {
      await callMissionTool('set_mission_criterion', {
        criterionId: criterion.id,
        met: true,
        evidence: 'test evidence',
        verifiedBy: 'test',
      });
    } catch (e) {
      error1 = e as Error;
    }

    expect(error1).not.toBeNull();
    expect(error1!.message).toMatch(/unreachable-test-module/);

    // Now add a production call site to the module
    // Write to scripts/ which is an exempt entrypoint (automatically considered reachable)
    mkdirSync(join(project, 'scripts'), { recursive: true });
    writeFileSync(
      join(project, 'scripts', 'use-module.ts'),
      `
import { testExport } from '../src/services/unreachable-test-module';

console.log(testExport());
`
    );

    execFileSync('git', ['add', '.'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'add production importer'], { cwd: project });

    const landSha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project })
      .toString('utf8')
      .trim();

    // Record the second land (with production importer added)
    recordEpicLand(project, {
      epicId: epic.id,
      epicTipSha: landSha2,
      landedMergeSha: landSha2,
      landedAt: Date.now(),
    });

    // Now met=true should succeed on the same criterion
    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'test evidence after importer added',
      verifiedBy: 'test',
    });

    expect(result.criterionId).toBe(criterion.id);
    expect(result.met).toBe(true);

    // Verify the store write succeeded
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(true);
  });

  test('case C: a serving epic with no land record grades normally (fail-open)', async () => {
    const { mission, criterion, epic, masterSha } = await setupMissionAndEpic('Case C');

    // Intentionally do NOT call recordEpicLand for this epic

    // Attempt to grade met=true — should NOT throw (fail-open behavior)
    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'no land record, fail-open',
      verifiedBy: 'test',
    });

    expect(result.criterionId).toBe(criterion.id);
    expect(result.met).toBe(true);

    // Verify the store write succeeded
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(true);
  });
});
