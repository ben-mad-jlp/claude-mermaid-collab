/**
 * blueprint-lab emit runner — for each CorpusCase (corpus.ts), builds the real
 * blueprint-node prompt (extended to require a v2 DiffContract json fence instead of the
 * v1 size-manifest fence), spawns the REAL `claude -p` node via buildNodeArgv at the model/
 * effort the daemon actually runs (NOT the opus/high NODE_PROFILE.blueprint default),
 * parses the reply with parseDiffContract, and returns a contract-or-null result per case.
 *
 * This is a lab-harness measurement script — it does not wire into the daemon pipeline,
 * does not modify diff-contract.ts / leaf-executor.ts / node-invoker.ts / corpus.ts, and
 * does not score against an "expected contract" (the corpus has none — emission-only).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildNodeArgv } from '../../src/agent/node-invoker';
import { parseDiffContract, type DiffContract } from '../../src/services/diff-contract';
import { CORPUS, type CorpusCase } from './corpus';

const OUT = join(import.meta.dir, 'results');
mkdirSync(OUT, { recursive: true });

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function buildV2BlueprintPrompt(c: CorpusCase): string {
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
    'FINISH your reply with EXACTLY ONE trailing fenced ```json block — it MUST be the LAST json',
    'fence in your reply and parse as this v2 DiffContract shape:',
    '```json',
    '{ "schemaVersion": 2, "estimatedFiles": <int>, "estimatedTasks": <int>,',
    '  "nonEnumerableFanout": <bool>, "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
    '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ],',
    '  "leafKind": "feature" | "fix" | "refactor" | "test" | "infra",',
    '  "requirements": [ /* symbol-present | named-test | threshold — see below */ ],',
    '  "outOfScope": ["<note>"] }',
    '```',
    'Each `requirements[]` entry is ONE of:',
    '  { "kind": "symbol-present", "file": "<path>", "symbol": "<name>", "description": "<why>" }',
    '  { "kind": "named-test", "testFile": "<path>", "testName": "<name>", "mechanical": true }',
    '  { "kind": "threshold", "source": "gate-output" | "grep-count", "metric": "<name>",',
    '    "comparison": "gte" | "lte" | "eq", "value": <number>, "mechanical": true }',
    'Pick `leafKind` from the title/description. `requirements` must name REAL symbols/tests you',
    'actually see or intend to add — never a placeholder.',
  ].join('\n');
}

function buildSpec(prompt: string) {
  return {
    prompt,
    model: process.env.BLUEPRINT_MODEL || 'sonnet',
    effort: (process.env.BLUEPRINT_EFFORT || 'medium') as const,
    allowedTools: 'Read Grep Glob Bash',
    permissionMode: 'bypassPermissions' as const,
    strictMcpConfig: true,
  };
}

function runEmitNode(cwd: string, prompt: string): Promise<{ text: string; raw: string }> {
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
      if (!text) text = `[[NO RESULT]] stderr=${err.slice(-400)}`;
      resolve({ text, raw: out });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function checkoutBase(c: CorpusCase): string {
  const cwd = mkdtempSync(join(tmpdir(), `emitlab-${c.id}-`));
  mkdirSync(cwd, { recursive: true });
  execFileSync('sh', ['-c', `git archive "${c.diff.baseSha}" | tar -x -C "${cwd}"`], { cwd: REPO_ROOT });
  return cwd;
}

interface EmitResult {
  id: string;
  leafKindExpected: CorpusCase['leafKind'];
  contract: DiffContract | null;
  rawText: string;
}

async function runOne(c: CorpusCase): Promise<EmitResult> {
  const cwd = checkoutBase(c);
  const prompt = buildV2BlueprintPrompt(c);
  const { text } = await runEmitNode(cwd, prompt);
  const contract = parseDiffContract(text);
  writeFileSync(join(OUT, `${c.id}.emit.md`), text);
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  return { id: c.id, leafKindExpected: c.leafKind, contract, rawText: text };
}

async function main() {
  const only = process.argv.slice(2);
  const cases = only.length ? CORPUS.filter((c) => only.includes(c.id)) : CORPUS;
  console.log(`emitting ${cases.length} case(s), concurrency 8 — blueprint model=${process.env.BLUEPRINT_MODEL || 'sonnet'} effort=${process.env.BLUEPRINT_EFFORT || 'medium'}`);
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
main();
