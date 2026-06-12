/**
 * Phase-0 spike (spike-owned-agent-harness): drive Grok as a coding worker via the
 * Vercel AI SDK — HEADLESS, in-process, with NO tmux, NO pane-scraping, NO `claude`.
 *
 * Proves the thesis: an owned harness turns every scrape seam into a typed event,
 * and completion is SERVER-AUTHORITATIVE — the sidecar runs the gate on the harness's
 * `done` and decides accept, instead of trusting a self-reported signal.
 *
 * Flow: fresh isolated git scratch repo (stands in for WorktreeManager.ensure) →
 * structured tools (write_file/read_file/list_dir/run_bash, all scoped to the repo) →
 * generateText({ model: xai('grok-build-0.1'), stopWhen: stepCountIs(40) }) →
 * on finish the SIDECAR runs the gate (test green + commit landed) and decides PASS.
 *
 * Run:  XAI_API_KEY=... bun run spike/grok-worker.ts
 */
import { generateText, stepCountIs, tool } from 'ai';
import { xai } from '@ai-sdk/xai';
import { z } from 'zod';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const MODEL = process.env.GROK_MODEL || 'grok-build-0.1';

// ── isolated scratch repo (the worktree stand-in) ────────────────────────────
const ROOT = mkdtempSync(join(tmpdir(), 'grok-spike-'));
function sh(cmd: string, cwd = ROOT) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || '') };
}
sh('git init -q && git config user.email spike@local && git config user.name spike && git commit -q --allow-empty -m init');
console.log(`[spike] isolated repo: ${ROOT}\n[spike] model: ${MODEL}\n`);

// ── structured tools, all sandboxed to ROOT (a real path can't escape) ───────
const safe = (p: string) => {
  const abs = resolve(ROOT, p);
  if (!abs.startsWith(ROOT)) throw new Error(`path escapes sandbox: ${p}`);
  return abs;
};
let toolCalls = 0;
const trace = (label: string) => { toolCalls++; process.stdout.write(`  · ${label}\n`); };

const tools = {
  write_file: tool({
    description: 'Create or overwrite a file (path relative to the repo root).',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => {
      const abs = safe(path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
      trace(`write_file ${path} (${content.length}b)`); return `wrote ${path}`;
    },
  }),
  read_file: tool({
    description: 'Read a file (path relative to the repo root).',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      trace(`read_file ${path}`);
      const abs = safe(path); return existsSync(abs) ? readFileSync(abs, 'utf8') : `(no such file: ${path})`;
    },
  }),
  list_dir: tool({
    description: 'List files in a directory (relative to repo root; default ".").',
    inputSchema: z.object({ path: z.string().default('.') }),
    execute: async ({ path }) => {
      trace(`list_dir ${path}`);
      try { return readdirSync(safe(path)).join('\n') || '(empty)'; } catch { return `(no such dir: ${path})`; }
    },
  }),
  run_bash: tool({
    description: 'Run a bash command in the repo root. Use it to run tests, git, etc.',
    inputSchema: z.object({ cmd: z.string() }),
    execute: async ({ cmd }) => {
      trace(`run_bash: ${cmd.slice(0, 70)}`);
      const r = sh(cmd); return `exit=${r.code}\n${r.out.slice(-2000)}`;
    },
  }),
};

// ── the task (a real, gateable coding leaf) ──────────────────────────────────
const TASK = [
  'You are a coding agent working inside a fresh git repo. Complete this task end to end:',
  '1. Create `math.ts` that exports two functions: `add(a, b)` and `sub(a, b)` (TypeScript).',
  '2. Create `math.test.ts` that imports them and asserts add(2,3)===5 and sub(5,2)===3 using `node:assert/strict`, runnable via `bun test`.',
  '3. Run the tests with `bun test` and confirm they PASS (iterate if they fail).',
  '4. When the tests pass, stage everything and commit with: git add -A && git commit -m "feat: math add/sub + tests".',
  'Use the tools. Do not ask questions — just do it, then stop.',
].join('\n');

// ── drive the loop (headless; no tmux, no pane-scraping) ──────────────────────
const t0 = Date.now();
const result = await generateText({
  model: xai(MODEL),
  tools,
  stopWhen: stepCountIs(40),
  system: 'You are an autonomous coding worker. Work only via the provided tools. Be terse.',
  prompt: TASK,
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n[spike] agent finished: ${result.steps.length} steps · ${toolCalls} tool calls · ${secs}s · finishReason=${result.finishReason}`);
const u: any = result.usage || {};
console.log(`[spike] tokens: in=${u.inputTokens ?? u.promptTokens ?? '?'} out=${u.outputTokens ?? u.completionTokens ?? '?'}`);

// ── SERVER-AUTHORITATIVE GATE (the sidecar decides done, not the agent) ──────
console.log('\n[spike] === sidecar gate (the daemon decides accept, not the agent) ===');
const filesOk = existsSync(join(ROOT, 'math.ts')) && existsSync(join(ROOT, 'math.test.ts'));
const test = sh('bun test 2>&1');
const testOk = test.code === 0 && /pass|✓|\b\d+ pass/i.test(test.out);
const log = sh('git log --oneline');
const committed = /math|feat/i.test(log.out) && log.out.trim().split('\n').length >= 2;

console.log(`  files present : ${filesOk ? 'PASS' : 'FAIL'}`);
console.log(`  bun test green: ${testOk ? 'PASS' : 'FAIL'}  (exit=${test.code})`);
console.log(`  commit landed : ${committed ? 'PASS' : 'FAIL'}`);
if (!testOk) console.log('  --- test output ---\n' + test.out.slice(-800).split('\n').map((l) => '  ' + l).join('\n'));

const ACCEPT = filesOk && testOk && committed;
console.log(`\n[spike] VERDICT: ${ACCEPT ? '✅ ACCEPTED — Grok closed a gated coding leaf headless (zero tmux / zero pane-scraping / zero claude)' : '❌ NOT ACCEPTED'}`);
console.log(`[spike] artifacts left in ${ROOT}`);
process.exit(ACCEPT ? 0 : 1);
