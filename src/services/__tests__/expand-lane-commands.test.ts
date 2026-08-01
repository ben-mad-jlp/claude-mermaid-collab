import { describe, expect, test } from 'bun:test';
import { expandLaneCommands, type GateTestLane } from '../leaf-gate';

// Regression guard for the land-gate wedge (dcbbb40b): the epic land gate FORCES every
// lane to mode:'per-file' (it runs the epic's touched files one-per-spawn). A batch lane
// whose template uses {files} must still get the single file substituted in per-file mode —
// the old /\{file\}/ regex left {files} literal, producing a malformed command that errored
// and read as a false regression → gate-failed, wedging every UI-touching land.
describe('expandLaneCommands', () => {
  test('per-file mode substitutes a {file} template', () => {
    const lane: GateTestLane = { mode: 'per-file', command: 'bun test {file}' } as GateTestLane;
    expect(expandLaneCommands(lane, ['a.test.ts', 'b.test.ts'])).toEqual([
      "bun test 'a.test.ts'",
      "bun test 'b.test.ts'",
    ]);
  });

  test('per-file mode ALSO substitutes a {files} template (the batch lane forced per-file) — never left literal', () => {
    const lane: GateTestLane = { mode: 'per-file', command: 'cd ui && bunx vitest {files}' } as GateTestLane;
    const out = expandLaneCommands(lane, ['ui/x.test.tsx', 'ui/y.test.tsx']);
    expect(out).toEqual([
      "cd ui && bunx vitest 'ui/x.test.tsx'",
      "cd ui && bunx vitest 'ui/y.test.tsx'",
    ]);
    // The bug: any surviving literal placeholder means the malformed-command wedge is back.
    for (const cmd of out) expect(cmd).not.toContain('{file');
  });

  test('batch mode joins all files into one {files} command (unchanged)', () => {
    const lane: GateTestLane = { mode: 'batch', command: 'cd ui && bunx vitest {files}' } as GateTestLane;
    expect(expandLaneCommands(lane, ['ui/x.test.tsx', 'ui/y.test.tsx'])).toEqual([
      "cd ui && bunx vitest 'ui/x.test.tsx' 'ui/y.test.tsx'",
    ]);
  });
});
