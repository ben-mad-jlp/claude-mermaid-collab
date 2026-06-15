/**
 * Worker-core LIVE smoke — drives runWorkerCore against the REAL grok model in a
 * throwaway /tmp git repo. Zero blast radius (no server, no daemon, no canonical
 * repo). Validates the recipe end-to-end: does grok-build run research→implement→
 * verify, emit valid typed JSON, use the tools, and produce the file?
 *
 *   bun run scripts/worker-core-smoke.ts
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { xai } from '@ai-sdk/xai';
import { getSecret } from '../src/services/config-service';
import { runWorkerCore, type WorkerCoreDeps } from '../src/agent/worker-core/orchestrator';

const key = getSecret('XAI_API_KEY');
if (!key) {
  console.error('No XAI_API_KEY resolvable — aborting.');
  process.exit(1);
}
process.env.XAI_API_KEY = key;

const cwd = mkdtempSync(join(tmpdir(), 'wc-smoke-'));
execSync('git init -q && git config user.email s@s.dev && git config user.name smoke && git commit -q --allow-empty -m init', {
  cwd,
  shell: '/bin/bash',
});
console.log(`worktree: ${cwd}\n`);

const TARGET = 'hello.txt';
const done = () => existsSync(join(cwd, TARGET));

const deps: WorkerCoreDeps = {
  getTodo: () => ({
    todoId: 'smoke',
    title: `Create a file named ${TARGET} in the worktree root containing exactly the single line: hello from worker-core`,
    behavioral: false,
  }),
  resolveModel: () => xai('grok-build-0.1'),
  // Real, meaningful gate for the smoke: did the deliverable actually appear?
  runScopedGate: async () => ({ pass: done(), errorSignatures: done() ? [] : [`${TARGET} was not created`] }),
  completeAccepted: async () => console.log('\n✅ COMPLETED (host-authoritative)'),
  escalate: async (_p, _t, kind, detail) => console.log(`\n⚠️  ESCALATED [${kind}] ${detail}`),
};

const r = await runWorkerCore(
  {
    project: 'smoke',
    todoId: 'smoke',
    cwd,
    abortSignal: AbortSignal.timeout(5 * 60 * 1000),
    onEvent: (e) => {
      if (e.type === 'phase-start') console.log(`\n▶ ${e.role}`);
      else if (e.type === 'step') {
        if (e.text) console.log(`  · ${e.text.slice(0, 220)}`);
        for (const c of e.toolCalls ?? []) console.log(`  → ${c.name}(${JSON.stringify(c.args).slice(0, 160)})`);
        for (const tr of e.toolResults ?? []) console.log(`  ← ${tr.name}: ${tr.result.slice(0, 160)}`);
      } else if (e.type === 'phase-end') {
        console.log(`◀ ${e.role} — ${e.steps} step(s)${e.parseError ? ` · parseError: ${e.parseError}` : ''}`);
      }
    },
  },
  deps,
);

console.log('\n=== OUTCOME ===', JSON.stringify(r));
console.log(`=== ${TARGET} ===`, done() ? JSON.stringify(readFileSync(join(cwd, TARGET), 'utf8')) : '(NOT created)');
console.log('=== files ===', readdirSync(cwd).filter((f) => f !== '.git'));
