/**
 * blueprint-lab emit runner — for each CorpusCase (corpus.ts), builds the real
 * blueprint-node prompt (extended to require a v2 DiffContract json fence instead of the
 * v1 size-manifest fence), spawns the REAL `claude -p` node via buildNodeArgv at the model/
 * effort the daemon actually runs (NOT the opus/high NODE_PROFILE.blueprint default),
 * parses the reply with parseDiffContract, applies exactly one bounded contract-repair pass
 * (when a parsed contract is non-null but underspecified per validateContractForKind, the node
 * is re-spawned once via buildBlueprintRepairPrompt and the repaired contract adopted iff it
 * re-parses; else the original is kept), and returns a contract-or-null result per case.
 *
 * This is a lab-harness measurement script — it does not wire into the daemon pipeline,
 * does not modify diff-contract.ts / leaf-executor.ts / node-invoker.ts / corpus.ts, and
 * does not score against an "expected contract" (the corpus has none — emission-only).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildNodeArgv, STDIN_DELIVERY_RE } from '../../src/agent/node-invoker';
import { parseDiffContract, validateContractForKind, type DiffContract } from '../../src/services/diff-contract';
import { resolveNodeModel, resolveNodeProvider } from '../../src/services/node-provider';
import { listNodeProfileOverrides, getProjectEffort } from '../../src/services/orchestrator-config';
import { NODE_PROFILE, buildBlueprintRepairPrompt } from '../../src/services/leaf-executor';
import { MANIFEST_JSON_SCHEMA_LINES, MANIFEST_SCHEMA_NOTES_LINES } from '../../src/services/leaf-prompts';
import { CORPUS, type CorpusCase } from './corpus';

const OUT = join(import.meta.dir, 'results');
mkdirSync(OUT, { recursive: true });

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const PROJECT = REPO_ROOT;

export function buildV2BlueprintPrompt(c: CorpusCase): string {
  return [
    'You are the BLUEPRINT node for ONE leaf todo. Do NOT write implementation code.',
    `Title: ${c.spec.title}`,
    `Description: ${c.spec.description || '(no description)'}`,
    'Read the relevant code (Read/Grep/Glob and Bash for inspection ONLY — no mutations).',
    'Produce a precise, self-contained implementation blueprint as your reply text (do not write a file).',
    'The blueprint must cite the real files/symbols to touch and the exact change shape.',
    'ACCEPTANCE CRITERIA must be POSITIVE and CITABLE: each names a concrete change a reviewer can',
    'point a `file:line` at. NEVER write an absence or non-goal as an acceptance criterion.',
    '',
    // The v2 schema + citability teaching are SHARED VERBATIM with the production blueprint prompt
    // (src/services/leaf-prompts.ts) so the lab measures the SAME contract the daemon actually
    // emits — never a divergent copy (bug d9ae1c52). Drift is caught by emit-prompt-parity.test.ts.
    ...MANIFEST_JSON_SCHEMA_LINES,
    ...MANIFEST_SCHEMA_NOTES_LINES,
  ].join('\n');
}

function resolveBlueprintModel(): string {
  if (process.env.BLUEPRINT_MODEL) return process.env.BLUEPRINT_MODEL; // explicit override wins
  const provider = resolveNodeProvider(PROJECT, 'blueprint', NODE_PROFILE.blueprint.allowedTools);
  return resolveNodeModel(PROJECT, 'blueprint', provider, NODE_PROFILE.blueprint.model);
}

function resolveBlueprintEffort(): string {
  if (process.env.BLUEPRINT_EFFORT) return process.env.BLUEPRINT_EFFORT; // explicit override wins
  const override = listNodeProfileOverrides(PROJECT).blueprint?.effort;
  const projectEffort = getProjectEffort(PROJECT);
  const envEffort = process.env.MERMAID_NODE_EFFORT;
  return override ?? projectEffort ?? envEffort ?? NODE_PROFILE.blueprint.effort;
}

function buildSpec(prompt: string) {
  return {
    prompt,
    model: resolveBlueprintModel(),
    effort: resolveBlueprintEffort() as any,
    allowedTools: 'Read Grep Glob Bash',
    permissionMode: 'bypassPermissions' as const,
    strictMcpConfig: true,
  };
}

/** Bounded respawns on the stdin prompt-delivery race (see below). */
const STDIN_RETRY_MAX = 3;

function runEmitNode(cwd: string, prompt: string, attempt = 0): Promise<{ text: string; raw: string; stderrTail: string }> {
  const argv = buildNodeArgv(buildSpec(prompt) as any);
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      let text = '';
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const o = JSON.parse(t);
          if (o.type === 'result' && typeof o.result === 'string') text = o.result;
        } catch { /* skip non-json lines */ }
      }
      if (!text) {
        // Stdin prompt-delivery race (node-invoker STDIN_DELIVERY_RE): the claude CLI enforces a
        // ~3s stdin deadline, and under this harness's concurrency the child can miss its stdin
        // bytes and die with zero tokens even though the prompt WAS provided. The daemon's real
        // invokeNode respawns on this fault; the lab hand-rolls its own spawn, so mirror that here
        // — a bounded respawn instead of a spurious [[PARSE FAILED]] (the observed 3/19 failures).
        if (STDIN_DELIVERY_RE.test(err) && attempt < STDIN_RETRY_MAX) {
          resolve(runEmitNode(cwd, prompt, attempt + 1));
          return;
        }
        text = `[[NO RESULT]] stderr=${err.slice(-400)}`;
      }
      resolve({ text, raw: out, stderrTail: err.slice(-4000) });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Model+effort provenance stamp prepended to every emitted `.emit.md`. Resumability reuses a
 *  prior emission ONLY when its stamp matches the current run, so a partial run can accumulate
 *  across attempts without ever mixing a stale/other-model emission into the measurement. A
 *  leading HTML comment does not affect parseDiffContract (last json fence) or score.ts (reads
 *  run.json, never the .emit.md files). */
const EMIT_STAMP_PREFIX = '<!-- blueprint-lab-emit';
function emitStamp(): string {
  return `${EMIT_STAMP_PREFIX} model=${resolveBlueprintModel()} effort=${resolveBlueprintEffort()} -->`;
}

type NodeReply = { text: string; raw: string; stderrTail: string };
type NodeSpawn = (prompt: string) => Promise<NodeReply>;

/** Emit a contract for one case, then apply EXACTLY ONE bounded contract-repair retry —
 *  mirroring the daemon's leaf-executor repair loop. If the first parsed contract is
 *  non-null but underspecified for its own leafKind, re-spawn the blueprint node ONCE via
 *  buildBlueprintRepairPrompt, re-parse, and keep the repaired contract when it parses (else
 *  fall back to the original). `spawn` is injected so tests can run without a real node. */
export async function emitWithRepair(
  c: CorpusCase,
  spawn: NodeSpawn,
): Promise<{ contract: DiffContract | null; reply: NodeReply; repairSpawns: number }> {
  const reply = await spawn(buildV2BlueprintPrompt(c));
  let contract = parseDiffContract(reply.text);
  let finalReply = reply;
  let repairSpawns = 0;

  if (contract !== null) {
    const validation = validateContractForKind(contract, contract.leafKind);
    if (validation.underspecified) {
      const leaf = { id: c.id, title: c.spec.title, description: c.spec.description } as
        Parameters<typeof buildBlueprintRepairPrompt>[0];
      const repairPrompt = buildBlueprintRepairPrompt(leaf, reply.text, validation.missingField);
      repairSpawns = 1;
      const repairReply = await spawn(repairPrompt);
      const repaired = parseDiffContract(repairReply.text);
      if (repaired !== null) {
        contract = repaired;
        finalReply = repairReply;
      }
    }
  }
  return { contract, reply: finalReply, repairSpawns };
}

function checkoutBase(c: CorpusCase): string {
  // Materialize the base tree with `git worktree add --detach` rather than
  // `git archive | tar`: on macOS bsdtar aborts restoring AppleDouble metadata
  // for tracked *.meta.json files ("Failed to restore metadata: File exists"),
  // which VOIDed every corpus case. worktree checkout is metadata-clean.
  const parent = mkdtempSync(join(tmpdir(), `emitlab-${c.id}-`));
  const cwd = join(parent, 'wt'); // must NOT pre-exist for `git worktree add`
  execFileSync('git', ['worktree', 'add', '--detach', cwd, c.diff.baseSha], { cwd: REPO_ROOT });
  return cwd;
}

interface EmitResult {
  id: string;
  leafKindExpected: CorpusCase['leafKind'];
  contract: DiffContract | null;
  rawText: string;
}

async function runOne(c: CorpusCase): Promise<EmitResult> {
  const outFile = join(OUT, `${c.id}.emit.md`);
  // RESUMABLE: the 77-case real-node run exceeds a single node/leaf wall-clock budget, so a run
  // killed partway must NOT lose finished cases. Reuse a prior emission iff it (a) carries THIS
  // run's model/effort stamp and (b) still parses to a contract — successive attempts then
  // accumulate toward the full corpus instead of restarting from zero. A stale/other-model or
  // failed emission has no matching stamp / no contract, so it is re-run fresh.
  if (existsSync(outFile)) {
    const prior = readFileSync(outFile, 'utf8');
    if (prior.startsWith(emitStamp())) {
      const priorContract = parseDiffContract(prior);
      if (priorContract !== null) {
        return { id: c.id, leafKindExpected: c.leafKind, contract: priorContract, rawText: prior };
      }
    }
  }
  const cwd = checkoutBase(c);
  const { contract, reply } = await emitWithRepair(c, (prompt) => runEmitNode(cwd, prompt));
  const { text, raw, stderrTail } = reply;
  if (contract === null) {
    const diagnostic = [
      `[[PARSE FAILED for ${c.id}]]`,
      '--- extracted text (what parseDiffContract saw) ---',
      text,
      '--- raw stdout tail (last 4000 chars) ---',
      raw.slice(-4000),
      '--- stderr tail (last 4000 chars) ---',
      stderrTail,
    ].join('\n\n');
    writeFileSync(outFile, diagnostic);
  } else {
    writeFileSync(outFile, `${emitStamp()}\n${text}`);
  }
  try { execFileSync('git', ['worktree', 'remove', '--force', cwd], { cwd: REPO_ROOT }); } catch {}
  try { rmSync(dirname(cwd), { recursive: true, force: true }); } catch {}
  return { id: c.id, leafKindExpected: c.leafKind, contract, rawText: text };
}

async function main() {
  const only = process.argv.slice(2);
  const cases = only.length ? CORPUS.filter((c) => only.includes(c.id)) : CORPUS;
  console.log(`emitting ${cases.length} case(s), concurrency 8 — blueprint model=${resolveBlueprintModel()} effort=${resolveBlueprintEffort()}`);
  const results: EmitResult[] = [];
  const CONC = 8;
  let i = 0;
  async function worker() {
    while (i < cases.length) {
      const c = cases[i++];
      const t0 = Date.now();
      try {
        const r = await runOne(c);
        results.push(r);
        const mark = r.contract !== null ? '✓' : '✗';
        console.log(`${mark} ${r.id.padEnd(10)} leafKind=${r.leafKindExpected.padEnd(8)} (${((Date.now() - t0) / 1000) | 0}s)`);
      } catch (e) {
        console.log(`! ${c.id} ERROR ${(e as Error).message}`);
        results.push({ id: c.id, leafKindExpected: c.leafKind, contract: null, rawText: `[[ERROR]] ${(e as Error).message}` });
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));
  const parsed = results.filter((r) => r.contract !== null).length;
  const unparsed = results.filter((r) => r.contract === null).map((r) => r.id);
  const summary = { total: results.length, parsed, unparsed, results };
  writeFileSync(join(OUT, 'run.json'), JSON.stringify(summary, null, 2));
  console.log(`\n=== ${parsed}/${results.length} parsed ===`);
  console.log(`UNPARSED: ${unparsed.join(', ') || 'none'}`);
}

if (import.meta.main) main();
