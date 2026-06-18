// watch-leaf.ts — live (or post-mortem) view of a leaf-executor run, read straight
// from the worker-ledger the executor writes. Works no matter which server is live.
//
//   bun run watch-leaf.ts --todo <id|prefix> [--since last|<ms>] [--watch]
//
// --since last (default): auto-detect the most recent run (largest gap in the ledger).
// --watch: poll every 3s until the leaf reaches a terminal outcome.

import { queryLedger } from '../src/services/worker-ledger';
import { listTodos, getTodo } from '../src/services/todo-store';
import { breakerOpen } from '../src/services/headless-breaker';

const project = '/Users/benmaderazo/Code/claude-mermaid-collab';
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k: string) => argv.includes(`--${k}`);

const prefix = arg('todo');
if (!prefix) { console.error('need --todo <id|prefix>'); process.exit(1); }
// Resolve prefix → full id. listTodos OMITS done/dropped todos, so a FINISHED leaf
// wouldn't resolve — fall back to the ledger (it keeps every row, terminal included).
const meta = listTodos(project).find((t) => t.id === prefix || t.id.startsWith(prefix)) ?? null;
let id = meta?.id;
if (!id) {
  const row = (queryLedger({ limit: 2000 }) as any[]).find((r) => String(r.todoId ?? r.leafId ?? '').startsWith(prefix));
  id = row?.todoId ?? row?.leafId ?? undefined;
}
if (!id) { console.error('not found in todos or ledger:', prefix); process.exit(1); }

function runStart(rows: any[]): number {
  // most recent run = rows after the largest inter-row time gap (>=90s)
  const sorted = rows.map((r) => r.ts).sort((a, b) => a - b);
  let start = sorted[0] ?? 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 90_000) start = sorted[i];
  return start;
}

const sinceArg = arg('since', 'last')!;

const PAD = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
const fmtDur = (ms?: number) => ms == null ? '   -  ' : `${(ms / 1000).toFixed(0)}s`.padStart(6);
const ICON: Record<string, string> = { blueprint: '📐', research: '🔎', sizegate: '📏', implement: '🔨', wimplement: '🔨', verify: '✅', fix: '🩹', review: '⚖️' };

function render(): { terminal: boolean } {
  const all: any[] = queryLedger({ todoId: id, limit: 2000 });
  const since = sinceArg === 'last' ? runStart(all) : Number(sinceArg);
  const rows = all.filter((r) => r.ts >= since).sort((a, b) => a.ts - b.ts);
  const t = getTodo(project, id); // returns done todos too (unlike listTodos)

  console.clear();
  console.log(`LEAF  ${id.slice(0, 8)}  ${t?.type ?? meta?.type ?? '-'}  ${t?.title ?? meta?.title ?? '(unknown)'}`);
  console.log(`run since ${new Date(since).toISOString().slice(11, 19)}  ·  todo status: ${t?.status}  acceptance: ${t?.acceptanceStatus ?? '-'}  ·  breaker: ${breakerOpen() ? 'OPEN' : 'closed'}`);
  console.log('─'.repeat(96));
  console.log(`${PAD('time', 9)}${PAD('node', 13)}${PAD('model', 8)}${PAD('dur', 7)}${PAD('$cost', 9)}${PAD('tok i/o', 14)}exit/flags`);
  let totUsd = 0, terminal = false, lastVerdict: any = null, lastOutcome: any = null;
  for (const r of rows) {
    totUsd += r.costUsd ?? 0;
    const flags = [r.rateLimited ? 'RATE-LIMITED' : '', r.exitCode !== 0 ? `exit${r.exitCode}` : 'ok', r.verdict ? `verdict=${r.verdict}` : '', r.parseError ? 'PARSE-ERR' : ''].filter(Boolean).join(' ');
    console.log(
      PAD(new Date(r.ts).toISOString().slice(11, 19), 9) +
      PAD(`${ICON[r.nodeKind] ?? '·'} ${r.nodeKind ?? r.phase}`, 13) +
      PAD(r.model ?? '-', 8) +
      PAD(fmtDur(r.durationMs), 7) +
      PAD('$' + (r.costUsd ?? 0).toFixed(2), 9) +
      PAD(`${r.inputTokens ?? 0}/${r.outputTokens ?? 0}`, 14) +
      flags,
    );
    const out = (r.outputText ?? '').trim().replace(/\s+/g, ' ');
    if (has('full') && out) {
      console.log('  ┌─ output ' + '─'.repeat(80));
      for (const line of (r.outputText ?? '').split('\n')) console.log('  │ ' + line);
      console.log('  └' + '─'.repeat(88));
    } else if (out) {
      console.log('  ↳ ' + (out.length > 140 ? out.slice(0, 140) + '…' : out));
    }
    if (r.verdict) lastVerdict = r.verdict;
    if (r.leafOutcome) { lastOutcome = r.leafOutcome; terminal = true; }
  }
  console.log('─'.repeat(96));
  const nodesSpent = rows.length;
  console.log(`nodes: ${nodesSpent}    total: $${totUsd.toFixed(2)}    last verdict: ${lastVerdict ?? '-'}    leafOutcome: ${lastOutcome ?? '(in flight)'}`);
  if (t && (t.status === 'blocked' || t.status === 'done' || t.acceptanceStatus)) terminal = true;
  return { terminal };
}

if (has('watch')) {
  // poll loop
  for (;;) {
    const { terminal } = render();
    if (terminal) { console.log('\n[terminal — stopping watch]'); break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
} else {
  render();
}
