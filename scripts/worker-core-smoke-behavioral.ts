/**
 * Worker-core BEHAVIORAL smoke — drives runWorkerCore against the REAL grok model on a
 * BEHAVIORAL todo in a throwaway /tmp git repo wired for `bun test`. Zero blast radius
 * (no server, no daemon, no canonical repo). Exercises the phases the non-behavioral
 * smoke skips: the diagram-as-spec (research → create_diagram), test-as-spec
 * (authortests writes failing tests), the implement→verify fix loop with a REAL test
 * gate (`bun test`), the anti-tamper guard, completeness review, and host completion.
 *
 *   bun run scripts/worker-core-smoke-behavioral.ts
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePathFs } from 'node:path';
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

const cwd = mkdtempSync(join(tmpdir(), 'wc-smoke-beh-'));
// A minimal repo `bun test` can run: package.json + an existing sibling test to imitate.
writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'wc-smoke-beh', private: true }, null, 2));
writeFileSync(
  join(cwd, 'sample.test.ts'),
  `import { test, expect } from 'bun:test';\ntest('sanity', () => { expect(1 + 1).toBe(2); });\n`,
);
execSync('git init -q && git config user.email s@s.dev && git config user.name smoke && git add -A && git commit -q -m init', {
  cwd,
  shell: '/bin/bash',
});
console.log(`worktree: ${cwd}\n`);

const project = cwd; // self-contained: diagrams land under <cwd>/.collab/...
const session = 'smoke-behavioral';

// Real gate: run `bun test` over the worktree. Passes only when the authored spec
// tests (and the sample) are green.
function runBunTest(): { pass: boolean; sig: string[] } {
  try {
    execSync('bun test', { cwd, shell: '/bin/bash', stdio: 'pipe' });
    return { pass: true, sig: [] };
  } catch (e) {
    const out = ((e as { stdout?: Buffer; stderr?: Buffer }).stderr?.toString() ?? '') +
      ((e as { stdout?: Buffer }).stdout?.toString() ?? '');
    const firstFail = out.split('\n').find((l) => /fail|error|expect/i.test(l)) ?? 'bun test failed';
    return { pass: false, sig: [firstFail.trim().slice(0, 120)] };
  }
}

const deps: WorkerCoreDeps = {
  getTodo: () => ({
    todoId: 'smoke-beh',
    title: 'Add and export a pure function `add(a: number, b: number): number` in src/calc.ts that returns a + b',
    description: 'Behavioral: a new exported function with defined arithmetic behavior. Cover it with a test.',
    behavioral: true,
  }),
  resolveModel: () => xai('grok-build-0.1'),
  describeRoute: () => ({ provider: 'grok-build', model: 'grok-build-0.1', source: 'default' }),
  runScopedGate: async () => {
    const r = runBunTest();
    return { pass: r.pass, errorSignatures: r.sig };
  },
  readWorktreeFiles: (laneCwd, paths) => {
    const out: Record<string, string | null> = {};
    for (const rel of paths) {
      try {
        const abs = resolvePathFs(laneCwd, rel);
        out[rel] = abs.startsWith(laneCwd) ? readFileSync(abs, 'utf8') : null;
      } catch {
        out[rel] = null;
      }
    }
    return out;
  },
  completeAccepted: async () => console.log('\n✅ COMPLETED (host-authoritative)'),
  escalate: async (_p, _t, kind, detail) => console.log(`\n⚠️  ESCALATED [${kind}] ${detail}`),
};

const r = await runWorkerCore(
  {
    project,
    todoId: 'smoke-beh',
    cwd,
    session,
    abortSignal: AbortSignal.timeout(8 * 60 * 1000),
    onEvent: (e) => {
      if (e.type === 'phase-start') console.log(`\n▶ ${e.role}${e.route ? ` → ${e.route.provider}/${e.route.model} (${e.route.source})` : ''}`);
      else if (e.type === 'step') {
        if (e.text) console.log(`  · ${e.text.slice(0, 200)}`);
        for (const c of e.toolCalls ?? []) console.log(`  → ${c.name}(${JSON.stringify(c.args).slice(0, 160)})`);
        for (const tr of e.toolResults ?? []) console.log(`  ← ${tr.name}: ${tr.result.slice(0, 140)}`);
      } else if (e.type === 'phase-end') {
        console.log(`◀ ${e.role} — ${e.steps} step(s) · $${(e.costUsd ?? 0).toFixed(4)}${e.parseError ? ` · parseError: ${e.parseError}` : ''}`);
      }
    },
  },
  deps,
);

console.log('\n=== OUTCOME ===', JSON.stringify(r));
console.log('=== files ===', readdirSync(cwd).filter((f) => f !== '.git'));
if (existsSync(join(cwd, 'src'))) console.log('=== src ===', readdirSync(join(cwd, 'src')));
for (const sub of ['sessions', 'workspaces']) {
  const dir = join(cwd, '.collab', sub, session, 'diagrams');
  if (existsSync(dir)) console.log('=== diagrams ===', readdirSync(dir).filter((f) => f.endsWith('.mmd')));
}
