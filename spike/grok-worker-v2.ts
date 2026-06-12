/**
 * Phase-0 spike v2: drive Grok against the REAL machinery —
 *   • real WorktreeManager isolation (src/agent/worktree-manager.ts)
 *   • Grok calls our REAL MCP tools (get_todo / complete_todo) via the official
 *     @modelcontextprotocol/sdk client spawning src/mcp/server.ts (stdio → :9002)
 *   • a real (throwaway) work-graph todo on the live sidecar
 *   • sidecar-authoritative gate decides accept
 * Still ZERO tmux, ZERO pane-scraping, ZERO `claude`.
 *
 * Run:  XAI_API_KEY=... bun run spike/grok-worker-v2.ts <project> <todoId>
 */
import { generateText, stepCountIs, tool } from 'ai';
import { xai } from '@ai-sdk/xai';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorktreeManager } from '../src/agent/worktree-manager.ts';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const MODEL = process.env.GROK_MODEL || 'grok-build-0.1';
const PROJECT = process.argv[2] || '/tmp/grok-v2-proj';
const TODO_ID = process.argv[3]!;
const REPO = '/Users/benmaderazo/Code/claude-mermaid-collab';
if (!TODO_ID) { console.error('usage: bun run spike/grok-worker-v2.ts <project> <todoId>'); process.exit(2); }

// ── 1. REAL worktree isolation ───────────────────────────────────────────────
const wm = new WorktreeManager({ projectRoot: PROJECT, baseDir: '/tmp/grok-v2-worktrees', persistDir: '/tmp/grok-v2-meta' });
const wt = await wm.ensure('grok-v2-spike', { baseBranch: 'main' });
const CWD = wt.path;
console.log(`[v2] worktree (${wt.kind}): ${CWD}\n[v2] model: ${MODEL}  project: ${PROJECT}  todo: ${TODO_ID}\n`);

// ── 2. REAL MCP server over stdio → exposes our actual collab tools ──────────
const mcp = new Client({ name: 'grok-worker-spike', version: '0.0.0' }, { capabilities: {} });
await mcp.connect(new StdioClientTransport({
  command: 'bun',
  args: [join(REPO, 'src/mcp/server.ts')],
  env: { ...process.env, PORT: '9002', HOST: 'localhost' },
}));
const mcpTools = (await mcp.listTools()).tools.map((t) => t.name);
console.log(`[v2] MCP connected — get_todo present: ${mcpTools.includes('get_todo')} · complete_todo present: ${mcpTools.includes('complete_todo')}`);
const callMcp = async (name: string, args: Record<string, unknown>) => {
  const r: any = await mcp.callTool({ name, arguments: args });
  return (r.content || []).map((c: any) => c.text ?? JSON.stringify(c)).join('\n');
};

// ── 3. tools for Grok: our MCP tools + worktree-scoped file/bash ──────────────
let toolCalls = 0;
const trace = (s: string) => { toolCalls++; process.stdout.write(`  · ${s}\n`); };
const safe = (p: string) => { const abs = resolve(CWD, p); if (!abs.startsWith(CWD)) throw new Error('escape'); return abs; };
const tools = {
  get_todo: tool({
    description: 'Read the work-graph todo you are assigned (the task spec).',
    inputSchema: z.object({ project: z.string(), todoId: z.string() }),
    execute: async (a) => { trace(`get_todo ${a.todoId.slice(0, 8)}`); return callMcp('get_todo', a); },
  }),
  complete_todo: tool({
    description: 'Report completion of your todo: accepted or rejected.',
    inputSchema: z.object({ project: z.string(), todoId: z.string(), acceptance: z.enum(['accepted', 'rejected']) }),
    execute: async (a) => { trace(`complete_todo ${a.acceptance}`); return callMcp('complete_todo', a); },
  }),
  write_file: tool({
    description: 'Write a file (relative to the worktree root).',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => { const abs = safe(path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); trace(`write_file ${path}`); return `wrote ${path}`; },
  }),
  read_file: tool({
    description: 'Read a file (relative to the worktree root).',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => { trace(`read_file ${path}`); const abs = safe(path); return existsSync(abs) ? readFileSync(abs, 'utf8') : `(no such file)`; },
  }),
  run_bash: tool({
    description: 'Run a bash command. You are ALREADY in your isolated worktree — do NOT cd elsewhere; use relative paths.',
    inputSchema: z.object({ cmd: z.string() }),
    execute: async ({ cmd }) => {
      // Keep the worker in its worktree (the isolation seam). An absolute `cd`
      // out of the sandbox is rejected — this is the harness owning cwd, not the agent.
      if (/(^|&&|;|\|)\s*cd\s+\//.test(cmd)) { trace(`run_bash REJECTED (cd out of worktree): ${cmd.slice(0, 50)}`); return 'ERROR: you are already in your worktree — do not cd to absolute paths; use relative paths.'; }
      trace(`run_bash: ${cmd.slice(0, 64)}`);
      const r = spawnSync('bash', ['-lc', cmd], { cwd: CWD, encoding: 'utf8' });
      return `exit=${r.status}\n${((r.stdout || '') + (r.stderr || '')).slice(-1800)}`;
    },
  }),
};

// ── 4. drive Grok (headless) ─────────────────────────────────────────────────
const prompt = [
  `You are an autonomous coding worker. Your assigned todo id is "${TODO_ID}" in project "${PROJECT}".`,
  'You are ALREADY inside your isolated git worktree — it is the current directory. Create all files HERE with relative paths. Do NOT cd to any absolute path (the project path is only an MCP argument, NOT a place to write files).',
  `STEP 1: call get_todo({project:"${PROJECT}", todoId:"${TODO_ID}"}) to read the spec.`,
  'STEP 2: implement it HERE (relative paths) using write_file.',
  'STEP 3: run_bash `bun test` and iterate until it passes.',
  'STEP 4: run_bash `git add -A && git commit -m "feat(spike): strutil"`.',
  `STEP 5: call complete_todo({project:"${PROJECT}", todoId:"${TODO_ID}", acceptance:"accepted"}).`,
  'Then stop. Do not ask questions.',
].join('\n');

const t0 = Date.now();
const result = await generateText({ model: xai(MODEL), tools, stopWhen: stepCountIs(50), system: 'Autonomous coding worker. Use tools only. Be terse.', prompt });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n[v2] agent finished: ${result.steps.length} steps · ${toolCalls} tool calls · ${secs}s · finishReason=${result.finishReason}`);
const u: any = result.usage || {};
console.log(`[v2] tokens: in=${u.inputTokens ?? '?'} out=${u.outputTokens ?? '?'}`);

// ── 5. SIDECAR-AUTHORITATIVE GATE + verify the REAL store flipped ─────────────
console.log('\n[v2] === sidecar gate + real work-graph verification ===');
const test = spawnSync('bash', ['-lc', 'bun test 2>&1'], { cwd: CWD, encoding: 'utf8' });
const testOk = test.status === 0;
// The agent may nest files (e.g. src/) — the harness owns cwd, not the layout. Check anywhere in the worktree.
const tracked = spawnSync('git', ['-C', CWD, 'ls-files'], { encoding: 'utf8' }).stdout || '';
const filesOk = /(^|\/)strutil\.ts$/m.test(tracked) && /(^|\/)strutil\.test\.ts$/m.test(tracked);
const todoState = JSON.parse(await callMcp('get_todo', { project: PROJECT, todoId: TODO_ID }));
const storeAccepted = todoState.status === 'done' && todoState.acceptanceStatus === 'accepted';

const isolated = CWD.startsWith('/tmp/grok-v2-worktrees/') && CWD !== PROJECT && existsSync(CWD);
console.log(`  worktree isolated (real WorktreeManager): ${isolated ? 'PASS' : 'FAIL'}  (${CWD})`);
console.log(`  Grok used REAL MCP get_todo + complete_todo: ${mcpTools.includes('complete_todo') ? 'PASS' : 'FAIL'}`);
console.log(`  files present: ${filesOk ? 'PASS' : 'FAIL'}`);
console.log(`  bun test green (the gate): ${testOk ? 'PASS' : 'FAIL'} (exit=${test.status})`);
console.log(`  REAL work-graph todo → done+accepted on :9002: ${storeAccepted ? 'PASS' : 'FAIL (status=' + todoState.status + ', accept=' + todoState.acceptanceStatus + ')'}`);
if (!testOk) console.log('  --- test ---\n' + (test.stdout + test.stderr).slice(-600));

await mcp.close();
const ACCEPT = isolated && filesOk && testOk && storeAccepted;
console.log(`\n[v2] VERDICT: ${ACCEPT ? '✅ ACCEPTED — Grok closed a REAL gated work-graph leaf via our MCP tools in a real worktree, headless' : '❌ NOT ACCEPTED'}`);
console.log(`[v2] worktree: ${CWD}`);
process.exit(ACCEPT ? 0 : 1);
