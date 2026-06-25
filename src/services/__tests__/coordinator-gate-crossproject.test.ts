// Cross-project acceptance gate (SEAM·collab): a todo TRACKED in project A but
// IMPLEMENTED in repo B must be gated against B's manifest + B's working tree —
// the observed f719e7e0 bug was that the gate ran in the tracking repo and was
// blind to the target's edits. Uses the REAL todo-store + project-manifest (no
// module mocks), so it must run under `bun test` (bun:sqlite).
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCoordinatorDeps } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'xproj-'));
  dirs.push(d);
  return d;
}
/** Write a .collab/project.json manifest with the given gate command. */
function writeManifest(project: string, gateCommand: string): void {
  mkdirSync(join(project, '.collab'), { recursive: true });
  writeFileSync(join(project, '.collab', 'project.json'), JSON.stringify({ gateCommand }), 'utf8');
}
/** A gate command that only PASSES when run with cwd inside that repo (it looks
 *  for a marker file present only there) — proving both manifest + cwd selection. */
const CWD_PROVING_GATE = `test -f ./IN_THIS_REPO && echo '{"passed":true,"reasons":["ran-here"]}' || echo '{"passed":false,"reasons":["wrong-cwd"]}'`;

afterEach(() => {
  for (const d of dirs) { try { _closeProject(d); } catch {} try { rmSync(d, { recursive: true, force: true }); } catch {} }
  dirs.length = 0;
});

describe('runGate cross-project target', () => {
  test('gates against the TARGET repo (manifest + cwd), not the tracking project', async () => {
    const tracking = tmp();
    const target = tmp();
    // Only the TARGET repo declares a gate + carries the marker file.
    writeManifest(target, CWD_PROVING_GATE);
    writeFileSync(join(target, 'IN_THIS_REPO'), 'x', 'utf8');

    const todo = await createTodo(tracking, { allowOrphan: true, ownerSession: 's', title: 'cross', targetProject: target });
    const verdict = await makeCoordinatorDeps().runGate!(tracking, todo.id);

    // If it ran in the tracking repo it would have found no manifest (null) or
    // failed the cwd marker check. Passing with "ran-here" proves target gating.
    expect(verdict).not.toBeNull();
    expect(verdict!.passed).toBe(true);
    expect(verdict!.reasons).toEqual(['ran-here']);
  });

  test('a stale tracking-repo gate would FAIL the cwd check (regression guard for the f719e7e0 bug)', async () => {
    const tracking = tmp();
    const target = tmp();
    // The TRACKING repo has the (wrong) gate + marker; the TARGET has neither.
    writeManifest(tracking, CWD_PROVING_GATE);
    writeFileSync(join(tracking, 'IN_THIS_REPO'), 'x', 'utf8');

    const todo = await createTodo(tracking, { allowOrphan: true, ownerSession: 's', title: 'cross', targetProject: target });
    // Gate resolves to TARGET → target has no manifest → null (no gate to run),
    // NOT a false pass off the tracking repo's marker.
    const verdict = await makeCoordinatorDeps().runGate!(tracking, todo.id);
    expect(verdict).toBeNull();
  });

  test('same-project todo (no targetProject) gates against the tracking project', async () => {
    const tracking = tmp();
    writeManifest(tracking, CWD_PROVING_GATE);
    writeFileSync(join(tracking, 'IN_THIS_REPO'), 'x', 'utf8');

    const todo = await createTodo(tracking, { allowOrphan: true, ownerSession: 's', title: 'local' });
    const verdict = await makeCoordinatorDeps().runGate!(tracking, todo.id);
    expect(verdict?.passed).toBe(true);
    expect(verdict?.reasons).toEqual(['ran-here']);
  });
});
