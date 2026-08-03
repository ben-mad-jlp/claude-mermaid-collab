#!/usr/bin/env bun

import { readFileSync } from 'fs';
import { join } from 'path';
import { queryLedgerThin } from '../src/services/worker-ledger';
import { trackingProjectRoot } from '../src/services/project-registry';
import os from 'os';

const CHANGED_FILE = 'src/services/worker-ledger.ts';
const CHANGED_TEST_FILE = 'src/services/__tests__/worker-ledger.test.ts';

// Pure helpers
export function isMeasurableReviewRow(r: { nodeKind?: string; durationMs?: number | null }): boolean {
  return r.nodeKind === 'review' && r.durationMs != null && r.durationMs > 0;
}

export function savingBound(gateMs: number, reviewMs: number): number {
  return Math.min(gateMs, reviewMs);
}

export function percentiles(xs: number[], ps: number[]): number[] {
  if (xs.length === 0) {
    return ps.map(() => NaN);
  }

  const sorted = [...xs].sort((a, b) => a - b);

  return ps.map((p) => {
    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const weight = rank - lower;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  });
}

interface GateConfig {
  typecheck?: string;
  tests?: Array<{ match: string; command: string; cwd?: string }>;
  typechecks?: Array<{ match: string; command: string; cwd?: string }>;
  suites?: Array<{ match: string; command: string; cwd?: string }>;
  floors?: Array<{ match: string; command: string; cwd?: string }>;
}

interface TriggeredLane {
  type: 'typecheck' | 'tests' | 'typechecks' | 'suites';
  command: string;
  cwd?: string;
  name: string;
}

function buildTriggeredLanes(gateConfig: GateConfig): TriggeredLane[] {
  const lanes: TriggeredLane[] = [];

  // typecheck is always triggered
  if (gateConfig.typecheck) {
    lanes.push({
      type: 'typecheck',
      command: gateConfig.typecheck,
      name: 'typecheck',
    });
  }

  // test lanes
  if (gateConfig.tests) {
    for (let i = 0; i < gateConfig.tests.length; i++) {
      const lane = gateConfig.tests[i];
      try {
        const pattern = new RegExp(lane.match);
        if (pattern.test(CHANGED_FILE)) {
          const command = lane.command
            .replace(/{file}/g, CHANGED_TEST_FILE)
            .replace(/{files}/g, CHANGED_TEST_FILE);
          lanes.push({
            type: 'tests',
            command,
            cwd: lane.cwd,
            name: `tests[${i}]`,
          });
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // typechecks lanes
  if (gateConfig.typechecks) {
    for (let i = 0; i < gateConfig.typechecks.length; i++) {
      const lane = gateConfig.typechecks[i];
      try {
        const pattern = new RegExp(lane.match);
        if (pattern.test(CHANGED_FILE)) {
          lanes.push({
            type: 'typechecks',
            command: lane.command,
            cwd: lane.cwd,
            name: `typechecks[${i}]`,
          });
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // suites lanes
  if (gateConfig.suites) {
    for (let i = 0; i < gateConfig.suites.length; i++) {
      const lane = gateConfig.suites[i];
      try {
        const pattern = new RegExp(lane.match);
        if (pattern.test(CHANGED_FILE)) {
          lanes.push({
            type: 'suites',
            command: lane.command,
            cwd: lane.cwd,
            name: `suites[${i}]`,
          });
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  return lanes;
}

interface LaneResult {
  lane: TriggeredLane;
  observations: number[];
}

async function spawnLane(lane: TriggeredLane): Promise<number> {
  const start = Date.now();
  const proc = Bun.spawn(['sh', '-c', lane.command], {
    cwd: lane.cwd ?? process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  const end = Date.now();
  return end - start;
}

async function timeLanes(lanes: TriggeredLane[], repeat: number): Promise<LaneResult[]> {
  const results: LaneResult[] = [];

  for (const lane of lanes) {
    const observations: number[] = [];
    for (let i = 0; i < repeat; i++) {
      const ms = await spawnLane(lane);
      observations.push(ms);
    }
    results.push({ lane, observations });
  }

  return results;
}

async function getGitHead(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  return output.trim();
}

export async function measure(): Promise<void> {
  // Resolve project root
  const project = trackingProjectRoot(process.cwd());

  // Query ledger
  const rows = queryLedgerThin({ project, limit: 2000 });
  const reviewRows = rows.filter(isMeasurableReviewRow);

  // Extract review stats
  const reviewDurations = reviewRows.map((r) => r.durationMs!);
  const reviewCount = reviewRows.length;
  const reviewFirst = reviewRows.length > 0 ? reviewRows[0].ts : null;
  const reviewLast = reviewRows.length > 0 ? reviewRows[reviewRows.length - 1].ts : null;

  // Read gate config
  const projectJsonPath = join(process.cwd(), '.collab', 'project.json');
  const projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
  const gateConfig: GateConfig = projectJson.gate ?? {};

  // Build and time triggered lanes
  const triggeredLanes = buildTriggeredLanes(gateConfig);

  // Parse --repeat flag
  let repeat = 1;
  for (const arg of process.argv) {
    const match = arg.match(/^--repeat=(\d+)$/);
    if (match) {
      repeat = Math.max(1, parseInt(match[1], 10));
    }
  }

  // Time the lanes
  const laneResults = await timeLanes(triggeredLanes, repeat);

  // Calculate composite gate ms (sum of last observed per lane)
  const compositeGateMs = laneResults.reduce((sum, r) => sum + r.observations[r.observations.length - 1], 0);

  // Calculate saving bounds
  const savingBounds = reviewDurations.map((reviewMs) => savingBound(compositeGateMs, reviewMs));
  const savingStats = {
    n: savingBounds.length,
    median: savingBounds.length > 0 ? percentiles(savingBounds, [50])[0] : NaN,
    p10: savingBounds.length > 0 ? percentiles(savingBounds, [10])[0] : NaN,
    p50: savingBounds.length > 0 ? percentiles(savingBounds, [50])[0] : NaN,
    p90: savingBounds.length > 0 ? percentiles(savingBounds, [90])[0] : NaN,
  };

  // Get git HEAD
  const gitHead = await getGitHead();

  // Build report
  const ledgerPath = join(process.env.MERMAID_SUPERVISOR_DIR ?? '~/.mermaid-collab', 'worker-ledger.db');
  const platform = process.platform;
  const release = os.release();

  console.log('=== Gate-Review Overlap Measurement ===');
  console.log(`Ledger path: ${ledgerPath}`);
  console.log(`Project filter: ${project}`);
  console.log(`Review rows: ${reviewCount} (limit: 2000)`);

  if (reviewCount > 0) {
    console.log(`  First ts: ${new Date(reviewFirst!).toISOString()}`);
    console.log(`  Last ts: ${new Date(reviewLast!).toISOString()}`);
  }

  console.log('\nTriggered gate lanes:');
  for (const result of laneResults) {
    const lane = result.lane;
    console.log(`  ${lane.name}: ${lane.command}`);
    if (lane.cwd) {
      console.log(`    cwd: ${lane.cwd}`);
    }
    console.log(`    observed ms: [${result.observations.join(', ')}]`);
  }

  console.log(`\nRepeat: ${repeat}`);
  console.log(`Composite gate ms (sum of last per lane): ${compositeGateMs}`);

  console.log('\nSaving bounds (min(gate, review)):');
  console.log(`  n: ${savingStats.n}`);
  console.log(`  median: ${savingStats.median.toFixed(1)}`);
  console.log(`  p10: ${savingStats.p10.toFixed(1)}`);
  console.log(`  p50: ${savingStats.p50.toFixed(1)}`);
  console.log(`  p90: ${savingStats.p90.toFixed(1)}`);

  console.log(`\nPlatform: ${platform}`);
  console.log(`OS release: ${release}`);
  console.log(`Git HEAD: ${gitHead}`);

  // Declare floors as declared-not-timed (but filter by match)
  if (gateConfig.floors && gateConfig.floors.length > 0) {
    const triggeredFloors = gateConfig.floors.filter((floor) => {
      try {
        const pattern = new RegExp(floor.match);
        return pattern.test(CHANGED_FILE);
      } catch {
        return false;
      }
    });

    if (triggeredFloors.length > 0) {
      console.log('\nFloors (declared, not timed - land-only gate, never per-leaf):');
      for (let i = 0; i < triggeredFloors.length; i++) {
        const floor = triggeredFloors[i];
        console.log(`  floor: ${floor.command}`);
        if (floor.cwd) {
          console.log(`    cwd: ${floor.cwd}`);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    await measure();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
