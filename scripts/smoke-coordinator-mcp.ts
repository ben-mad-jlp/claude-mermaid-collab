/**
 * Live MCP-wire smoke test — PCS Phase 2c coordinator MCP tools.
 *
 * Spawns a FRESH stdio MCP server (src/mcp/server.ts) and drives the three new
 * tools over JSON-RPC: start_coordinator, stop_coordinator, complete_todo.
 * Does NOT touch the long-running server's MCP connection or other sessions.
 *
 * start→immediate stop means the 30s tick never fires, so no real worker spawns.
 *
 * Requires the HTTP API server running on :9002 (server.ts checks /api/health).
 * Run:  bun run scripts/smoke-coordinator-mcp.ts
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo } from '../src/services/todo-store';
import { recordStatus, recordContextPercent, recordCheckpointReady } from '../src/services/session-status-store';

const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const project = mkdtempSync(join(tmpdir(), 'pcs-mcp-'));
// Isolate the global supervisor.db so the smoke never touches the real one.
const supervisorDir = mkdtempSync(join(tmpdir(), 'pcs-mcp-sup-'));
log(`\n🔬 PCS Phase 2c MCP-wire smoke test\n   project: ${project}\n`);

// Seed: ready root + blocked dependent (so complete_todo can promote).
const root = await createTodo(project, { ownerSession: 'mcp-smoke', title: 'mcp root', status: 'ready' });
const dep = await createTodo(project, { ownerSession: 'mcp-smoke', title: 'mcp dependent', status: 'blocked', dependsOn: [root.id] });

// --- Spawn the stdio MCP server ---
const proc = Bun.spawn(['bun', 'src/mcp/server.ts'], {
  cwd: import.meta.dir + '/..',
  env: { ...process.env, MERMAID_SUPERVISOR_DIR: supervisorDir },
  stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
});

const decoder = new TextDecoder();
let buf = '';
const pending = new Map<number, (msg: any) => void>();
let nextId = 1;

(async () => {
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk);
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
      } catch { /* non-JSON log line */ }
    }
  }
})();

function send(method: string, params?: any): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 30_000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    proc.stdin.flush?.();
  });
}
function notify(method: string, params?: any) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  proc.stdin.flush?.();
}
// MCP tool calls return { result: { content: [{ type:'text', text }] } }; parse the text payload.
const payload = (resp: any) => {
  const text = resp?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
};

try {
  // 1. Handshake
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  check('initialize handshake', !!init?.result?.serverInfo, `server=${init?.result?.serverInfo?.name}`);
  notify('notifications/initialized');

  // 2. tools/list includes the new tools
  const tools = await send('tools/list', {});
  const names: string[] = (tools?.result?.tools ?? []).map((t: any) => t.name);
  check('start_coordinator listed', names.includes('start_coordinator'));
  check('stop_coordinator listed', names.includes('stop_coordinator'));
  check('complete_todo listed', names.includes('complete_todo'));
  check('get_todo listed', names.includes('get_todo'));

  // get_todo reads the claimed todo's spec (worker uses this)
  const got = payload(await send('tools/call', { name: 'get_todo', arguments: { project, todoId: root.id } }));
  check('get_todo returns the todo', got?.id === root.id && got?.title === 'mcp root', JSON.stringify(got?.id));

  // 3. start_coordinator → {started:true, running:true}
  const started = payload(await send('tools/call', { name: 'start_coordinator', arguments: { project } }));
  check('start_coordinator started', started?.started === true && started?.running === true, JSON.stringify(started));

  // 4. stop_coordinator IMMEDIATELY (before the 30s tick) → {stopped:true}
  const stopped = payload(await send('tools/call', { name: 'stop_coordinator', arguments: { project } }));
  check('stop_coordinator stopped', stopped?.stopped === true, JSON.stringify(stopped));

  // 5. start again then stop is idempotent-safe (second start true, third stop true)
  const s2 = payload(await send('tools/call', { name: 'start_coordinator', arguments: { project } }));
  check('start_coordinator re-start', s2?.started === true);
  await send('tools/call', { name: 'stop_coordinator', arguments: { project } });

  // 6. complete_todo → root done, dependent promoted
  const completed = payload(await send('tools/call', { name: 'complete_todo', arguments: { project, todoId: root.id, acceptance: 'accepted' } }));
  check('complete_todo promoted dependent', Array.isArray(completed?.promoted) && completed.promoted.includes(dep.id), JSON.stringify(completed));
  check('root persisted done', getTodo(project, root.id)?.status === 'done');
  check('dependent persisted ready', getTodo(project, dep.id)?.status === 'ready');

  // 7. error path: complete_todo missing arg → JSON-RPC error
  const bad = await send('tools/call', { name: 'complete_todo', arguments: { project } });
  check('missing-arg → error', !!bad?.error || /Missing required/.test(bad?.result?.content?.[0]?.text ?? ''), JSON.stringify(bad?.error ?? bad?.result));

  // 8. context-watchdog handshake
  check('checkpoint_ready listed', names.includes('checkpoint_ready'));
  check('supervisor_clear_session listed', names.includes('supervisor_clear_session'));

  // 8a. gate refuses before any checkpoint
  const preClear = payload(await send('tools/call', { name: 'supervisor_clear_session', arguments: { project, session: 'wf-sess' } }));
  check('clear refused pre-checkpoint', preClear?.cleared === false && preClear?.reason === 'checkpoint-not-ready', JSON.stringify(preClear));

  // 8b. write a real checkpoint doc, then checkpoint_ready verifies its recency
  const made = payload(await send('tools/call', { name: 'create_document', arguments: { project, session: 'wf-sess', name: 'vibe.vibeinstructions', content: '# checkpoint\nstate saved' } }));
  const docId = made?.id;
  check('checkpoint doc created', !!docId, JSON.stringify(docId));
  const ckpt = payload(await send('tools/call', { name: 'checkpoint_ready', arguments: { project, session: 'wf-sess', checkpointDocId: docId } }));
  check('checkpoint_ready verified persisted', ckpt?.persisted === true, JSON.stringify(ckpt));

  // 8c. gate now PASSES the readiness check (clear attempt no longer blocked on readiness;
  //     it fails only because there's no live tmux session — proving the gate let it through)
  const postClear = payload(await send('tools/call', { name: 'supervisor_clear_session', arguments: { project, session: 'wf-sess' } }));
  check('gate passes after checkpoint', postClear?.cleared === false && postClear?.reason !== 'checkpoint-not-ready', JSON.stringify(postClear));

  // 8d. checkpoint_ready rejects a missing doc (no false persisted)
  const bogus = payload(await send('tools/call', { name: 'checkpoint_ready', arguments: { project, session: 'wf-sess', checkpointDocId: 'does-not-exist' } }));
  check('checkpoint_ready rejects missing doc', bogus?.persisted === false && bogus?.reason === 'checkpoint-doc-not-found', JSON.stringify(bogus));

  // 8e. todo-based checkpoint (the primary vibe-checkpoint path): dependent todo
  //     `dep` was just promoted (updatedAt fresh) → verifies as persisted.
  const ckptTodo = payload(await send('tools/call', { name: 'checkpoint_ready', arguments: { project, session: 'wf-sess', checkpointTodoId: dep.id } }));
  check('checkpoint_ready verifies a todo', ckptTodo?.persisted === true && ckptTodo?.artifact === `todo:${dep.id}`, JSON.stringify(ckptTodo));
  const ckptBadTodo = payload(await send('tools/call', { name: 'checkpoint_ready', arguments: { project, session: 'wf-sess', checkpointTodoId: 'nope' } }));
  check('checkpoint_ready rejects missing todo', ckptBadTodo?.persisted === false && ckptBadTodo?.reason === 'checkpoint-todo-not-found', JSON.stringify(ckptBadTodo));

  // 9. watchdog control-loop scan: seed an idle-hot session + a ready session.
  check('supervisor_watchdog_scan listed', names.includes('supervisor_watchdog_scan'));
  recordContextPercent(project, 'hot', 85);     // seeds status, fresh reading
  recordStatus(project, 'hot', 'waiting');        // idle boundary (preserves percent)
  recordCheckpointReady(project, 'ready-sess');   // already persisted → clear
  recordContextPercent(project, 'cold', 20);
  recordStatus(project, 'cold', 'waiting');
  const scan = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  const bySession = new Map((scan?.actions ?? []).map((x: any) => [x.session, x.action]));
  check('scan → checkpoint for idle-hot', bySession.get('hot') === 'checkpoint', JSON.stringify(scan?.actions));
  check('scan → clear for ready session', bySession.get('ready-sess') === 'clear');
  check('scan ignores cold session', !bySession.has('cold'));

  // 9a. durable debounce: a second scan suppresses the repeat 'checkpoint' nudge
  //     (but 'clear' still passes through — marker-driven, not debounced).
  const scan2 = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  const by2 = new Map((scan2?.actions ?? []).map((x: any) => [x.session, x.action]));
  check('2nd scan suppresses repeat checkpoint', !by2.has('hot') && (scan2?.suppressed ?? 0) >= 1, JSON.stringify(scan2));
  check('2nd scan still emits clear', by2.get('ready-sess') === 'clear');

  // 10. per-project threshold config: a 55%-idle session is under the 80% default,
  //     but lowering the project threshold to 50 makes it a checkpoint candidate.
  check('set_watchdog_threshold listed', names.includes('set_watchdog_threshold'));
  recordContextPercent(project, 'mid', 55);
  recordStatus(project, 'mid', 'waiting');
  const defScan = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  check('default threshold ignores 55% session', !new Map((defScan?.actions ?? []).map((x: any) => [x.session, x.action])).has('mid') && defScan?.thresholdPercent === 80, JSON.stringify(defScan?.thresholdPercent));
  const setRes = payload(await send('tools/call', { name: 'set_watchdog_threshold', arguments: { project, thresholdPercent: 50 } }));
  check('threshold set to 50', setRes?.thresholdPercent === 50, JSON.stringify(setRes));
  const lowScan = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  const byLow = new Map((lowScan?.actions ?? []).map((x: any) => [x.session, x.action]));
  check('lowered threshold checkpoints 55% session', byLow.get('mid') === 'checkpoint' && lowScan?.thresholdPercent === 50, JSON.stringify(lowScan));
  const badThresh = await send('tools/call', { name: 'set_watchdog_threshold', arguments: { project, thresholdPercent: 150 } });
  check('rejects out-of-range threshold', !!badThresh?.error || /1-100/.test(badThresh?.result?.content?.[0]?.text ?? ''), JSON.stringify(badThresh?.error ?? badThresh?.result));

  // 11. supervisor audit log: a clear + checkpoint earlier should be recorded durably.
  check('supervisor_audit_list listed', names.includes('supervisor_audit_list'));
  const audit = payload(await send('tools/call', { name: 'supervisor_audit_list', arguments: { project } }));
  const kinds = new Set((audit?.entries ?? []).map((e: any) => e.kind));
  check('audit recorded checkpoint + clear', kinds.has('checkpoint') && kinds.has('clear'), JSON.stringify([...kinds]));
  // coordinator lifecycle is traced too: complete_todo earlier recorded a 'complete' entry
  check('audit traces coordinator complete', kinds.has('complete'), JSON.stringify([...kinds]));
  const cleared = payload(await send('tools/call', { name: 'supervisor_audit_list', arguments: { project, kind: 'clear' } }));
  check('audit filters by kind', (cleared?.entries ?? []).every((e: any) => e.kind === 'clear') && (cleared?.entries?.length ?? 0) >= 1, JSON.stringify(cleared?.entries?.length));

  // 12. reconcile result submission is dispatchable; unknown id → accepted:false
  check('submit_reconcile_result listed', names.includes('submit_reconcile_result'));
  const noPending = payload(await send('tools/call', { name: 'submit_reconcile_result', arguments: { reconcileId: 'nope', mergedGraph: [] } }));
  check('submit unknown id → accepted:false', noPending?.accepted === false, JSON.stringify(noPending));

  // 13. agent-profile type assignment: add_session_todo infers `type` from files
  const apiTodo = payload(await send('tools/call', { name: 'add_session_todo', arguments: { project, session: 'wf-sess', text: 'add route', files: ['src/routes/api.ts'] } }));
  const apiGot = payload(await send('tools/call', { name: 'get_todo', arguments: { project, todoId: apiTodo?.id } }));
  check('add_session_todo infers type from files', apiGot?.type === 'api', JSON.stringify(apiGot?.type));
  const uiTodo = payload(await send('tools/call', { name: 'add_session_todo', arguments: { project, session: 'wf-sess', text: 'button', files: ['ui/src/components/Btn.tsx'] } }));
  check('infers ui type', payload(await send('tools/call', { name: 'get_todo', arguments: { project, todoId: uiTodo?.id } }))?.type === 'ui');
  const explicitTodo = payload(await send('tools/call', { name: 'add_session_todo', arguments: { project, session: 'wf-sess', text: 'x', type: 'backend', files: ['ui/x.tsx'] } }));
  check('explicit type overrides inference', payload(await send('tools/call', { name: 'get_todo', arguments: { project, todoId: explicitTodo?.id } }))?.type === 'backend');

  // 14. decision_record MCP tools (#9): constraint needs approval; decision auto-active
  const con = payload(await send('tools/call', { name: 'create_decision_record', arguments: { project, kind: 'constraint', title: 'no cross-epic imports', epicId: 'E1' } }));
  check('create constraint → proposed', con?.status === 'proposed', JSON.stringify(con?.status));
  check('proposed constraint NOT in active set', (payload(await send('tools/call', { name: 'get_active_constraints', arguments: { project, epicId: 'E1' } }))?.constraints ?? []).length === 0);
  const appr = payload(await send('tools/call', { name: 'approve_decision_record', arguments: { project, id: con?.id, approvedBy: 'human' } }));
  check('approve → active', appr?.status === 'active' && appr?.approvedBy === 'human', JSON.stringify(appr?.status));
  check('approved constraint now in active set', (payload(await send('tools/call', { name: 'get_active_constraints', arguments: { project, epicId: 'E1' } }))?.constraints ?? []).some((c: any) => c.id === con?.id));
  const dec = payload(await send('tools/call', { name: 'create_decision_record', arguments: { project, kind: 'decision', title: 'use bun:sqlite' } }));
  check('decision auto-active', dec?.status === 'active');
  const listed = payload(await send('tools/call', { name: 'list_decision_records', arguments: { project, kind: 'constraint' } }));
  check('list filters by kind', (listed?.records ?? []).every((r: any) => r.kind === 'constraint') && (listed?.records?.length ?? 0) >= 1);

  // 14b. graph-drift check dispatchable (no blueprints in scratch project → 0 tasks, no findings)
  check('check_graph_drift listed', names.includes('check_graph_drift'));
  const drift = payload(await send('tools/call', { name: 'check_graph_drift', arguments: { project, session: 'wf-sess' } }));
  check('check_graph_drift returns findings+tasksScanned', Array.isArray(drift?.findings) && typeof drift?.tasksScanned === 'number', JSON.stringify(drift));

  // 15. emergency pause/override gates the driving actions
  const paused = payload(await send('tools/call', { name: 'supervisor_pause', arguments: { scope: project } }));
  check('supervisor_pause sets paused', paused?.paused === true && paused?.scope === project, JSON.stringify(paused));
  const pausedScan = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  check('watchdog scan no-ops while paused', pausedScan?.paused === true && (pausedScan?.actions ?? []).length === 0, JSON.stringify(pausedScan));
  const pausedNudge = payload(await send('tools/call', { name: 'supervisor_nudge', arguments: { project, session: 'x', text: 'go' } }));
  check('nudge skipped while paused', pausedNudge?.skipped === 'paused', JSON.stringify(pausedNudge));
  await send('tools/call', { name: 'supervisor_resume', arguments: { scope: project } });
  const resumedScan = payload(await send('tools/call', { name: 'supervisor_watchdog_scan', arguments: { project } }));
  check('watchdog scan active after resume', resumedScan?.paused === undefined, JSON.stringify(resumedScan?.paused));
} catch (e) {
  fail++;
  log(`  ❌ exception — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  proc.kill();
  if (existsSync(project)) { rmSync(project, { recursive: true, force: true }); log(`\nCleanup\n  🧹 removed temp project`); }
  if (existsSync(supervisorDir)) { rmSync(supervisorDir, { recursive: true, force: true }); log(`  🧹 removed temp supervisor dir`); }
}

log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
