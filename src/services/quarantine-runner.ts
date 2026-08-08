import { join } from 'node:path';
import {
  GateSpawn,
  defaultGateSpawn,
  resolveLeafGate,
  resolveLanes,
  expandLaneCommands,
  GateTestLane,
} from './leaf-gate';
import { isQuarantined } from './quarantine';
import { extractFailingTests, synthesizeLaneFailureIdentity } from './gate-runner';
import { loadProjectManifest } from '../config/project-manifest';

export interface QuarantinedSpecResult {
  ran: boolean;
  committed: boolean;
  quarantined: boolean;
  red: boolean;
  output: string;
  failureIdentity: string | null;
}

/**
 * Direct-spawns one committed quarantined spec's lane command.
 *
 * Short-circuit control flow: each step returns early if a gate fails.
 * 1. Check if path is quarantined (if not, return immediately)
 * 2. Check if path is committed to git
 * 3. Resolve the lane from the project manifest
 * 4. Expand and spawn the lane command for this one file
 * 5. Extract failure identity from the output if red
 *
 * This runner bypasses routeSpecsToLanes because that function hard-excludes
 * quarantined specs (leaf-gate.ts:1127), which is correct for gates and wrong
 * here — we call the lane primitives directly instead.
 */
export async function runQuarantinedSpec(
  project: string,
  repoRelPath: string,
  io?: { spawn?: GateSpawn },
): Promise<QuarantinedSpecResult> {
  // Gate 1: Is this path quarantined?
  const quarantined = isQuarantined(repoRelPath);
  if (!quarantined) {
    return {
      ran: false,
      committed: false,
      quarantined: false,
      red: false,
      output: '',
      failureIdentity: null,
    };
  }

  // Gate 2: Is the path committed to git?
  const spawn = io?.spawn ?? defaultGateSpawn;
  const commitCheck = await spawn(project, `git ls-tree HEAD -- '${repoRelPath.replace(/'/g, "'\\''")}'`);
  // Committed iff: spawn ran, exit code was 0, and there was output (the file is in the tree)
  const committed = commitCheck.ran && commitCheck.code === 0 && commitCheck.output.trim().length > 0;
  if (!committed) {
    return {
      ran: false,
      committed: false,
      quarantined: true,
      red: false,
      output: '',
      failureIdentity: null,
    };
  }

  // Gate 3: Resolve the lane
  const cfg = resolveLeafGate(loadProjectManifest(project));
  const lanes = cfg ? resolveLanes(cfg) : null;
  const lane = lanes?.find((l) => l.match.test(repoRelPath));
  if (!lane) {
    return {
      ran: false,
      committed: true,
      quarantined: true,
      red: false,
      output: `no gate lane matches ${repoRelPath}`,
      failureIdentity: null,
    };
  }

  // Step 4: Strip the lane's cwd prefix exactly as routeSpecsToLanes does
  // (leaf-gate.ts:1122-1132). This is the SAME lane-resolution machinery
  // routeSpecsToLanes uses, called directly on ONE path instead of through
  // the batch router.
  const rel = lane.cwd
    ? repoRelPath.slice(lane.cwd.replace(/\/+$/, '').length + 1)
    : repoRelPath;
  const commands = expandLaneCommands(lane, [rel]);
  const command = commands[0];

  // Step 5: Spawn the command
  const laneCwd = lane.cwd ? join(project, lane.cwd) : project;
  const r = await spawn(laneCwd, command);

  if (!r.ran) {
    return {
      ran: false,
      committed: true,
      quarantined: true,
      red: false,
      output: r.output,
      failureIdentity: null,
    };
  }

  // Step 6: Derive failure identity if red
  const red = r.code !== 0;
  let failureIdentity: string | null = null;

  if (red) {
    // Use the same combinator leaf-gate.ts:918-927 uses
    const fingerprints = extractFailingTests(r.output);
    if (fingerprints.length === 0) {
      // The laneKey is the FIXED string 'quarantine', never repoRelPath or
      // lane.match.source derived from the file's own name — this keeps
      // identity byte-identical across a git mv of the spec.
      const synthetic = synthesizeLaneFailureIdentity('quarantine', r.output);
      if (synthetic) {
        failureIdentity = synthetic;
      }
    } else {
      // For bun test lanes, extractFailingTests returns path-free test names.
      // A vitest lane's FAIL <path> line would embed the path — out of scope
      // for this leaf (the acceptance falsifier commits a bun test-lane spec).
      failureIdentity = fingerprints.join(' | ');
    }
  }

  return {
    ran: true,
    committed: true,
    quarantined: true,
    red,
    output: r.output,
    failureIdentity,
  };
}

/**
 * Build the repoRelPath → failureIdentity dedup map for the whole quarantine suite.
 * Only includes entries where the spec is red and has a non-null failureIdentity.
 * This is the dedup index described in quarantine.ts's header comment:
 * "run it — if the observation is already covered by a red quarantined test, this is a recurrence".
 */
export async function quarantineSuiteIdentities(
  project: string,
): Promise<Map<string, string>> {
  const spawn = defaultGateSpawn;

  // Walk committed quarantined specs
  const lsResult = await spawn(project, 'git ls-tree -r --name-only HEAD');
  if (!lsResult.ran) {
    return new Map();
  }

  const specs = lsResult.output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isQuarantined(line));

  const identities = new Map<string, string>();

  for (const spec of specs) {
    const result = await runQuarantinedSpec(project, spec, { spawn });
    // Only include entries where red && failureIdentity != null
    if (result.red && result.failureIdentity) {
      identities.set(spec, result.failureIdentity);
    }
  }

  return identities;
}
