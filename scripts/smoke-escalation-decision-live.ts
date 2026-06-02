/**
 * Live end-to-end smoke test — escalation-decision loop (ED1→ED2→ED3→ED4).
 *
 * Exercises the REAL production code paths the UI decision card drives:
 *   worker files a structured escalation (options + recommended)        [ED1]
 *     →  worker awaits via the poll-await relay (await_human_decision)   [ED2]
 *     →  human clicks an option → POST /api/supervisor/escalation/:id/decide
 *        (the exact route ProjectScopeSection's decideEscalation calls)  [ED3]
 *     →  the awaiting worker resumes with the chosen optionId
 *     →  the escalation auto-resolves (off the open inbox).              [ED4]
 *
 * The decide step is dispatched through handleSupervisorRoutes — the same
 * handler the HTTP server invokes — so this is the in-app path minus the
 * browser. (A true desktop-MCP click check additionally needs the UI running on
 * :9102; this script verifies the full backend loop deterministically and in
 * isolation, like smoke-coordinator-live.ts.)
 *
 * Controlled: throwaway isolated supervisor.db; no tmux; no external server.
 *
 * Run:  bun run scripts/smoke-escalation-decision-live.ts
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const supDir = mkdtempSync(join(tmpdir(), 'ed-smoke-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import {
  createEscalation,
  getEscalation,
  getEscalationDecision,
  listOpenEscalations,
} from '../src/services/supervisor-store';
import { awaitHumanDecision } from '../src/services/decision-relay';
import { handleSupervisorRoutes } from '../src/routes/supervisor-routes';

const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** POST the decide route exactly as the UI card does. */
async function clickOption(id: string, optionId: string, note?: string): Promise<number> {
  const req = new Request(`http://local/api/supervisor/escalation/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ optionId, note }),
  });
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return res?.status ?? 0;
}

log(`\n🔬 Escalation-decision live smoke test`);
log(`   supervisor.db: ${supDir}\n`);

try {
  // --- Phase 1: a worker files a structured escalation ---
  log(`Phase 1 — worker files a structured escalation (options + recommended)`);
  const { escalation, isNew } = createEscalation({
    project: '/smoke/ed',
    session: 'worker-deadbeef',
    kind: 'decision',
    questionText: 'Use approach A or B for the cache layer?',
    todoId: 'deadbeef-0000-0000-0000-000000000000',
    options: [
      { id: 'a', label: 'In-memory LRU', detail: 'simpler, bounded' },
      { id: 'b', label: 'Redis', detail: 'shared, scales out' },
    ],
    recommended: 'a',
  });
  check('escalation created (isNew)', isNew === true);
  check('carries structured options', (escalation.options?.length ?? 0) === 2, `options=${JSON.stringify(escalation.options)}`);
  check('carries recommendation', escalation.recommended === 'a', `recommended=${escalation.recommended}`);
  check('shows in the open inbox', listOpenEscalations().some((e) => e.id === escalation.id));

  // --- Phase 2+3: worker awaits; human clicks option B; worker resumes ---
  log(`\nPhase 2 — worker awaits the decision; human clicks an option`);
  const awaiting = awaitHumanDecision(escalation.id, { timeoutMs: 5_000, pollMs: 10 });
  // Simulate the UI decision card click shortly after the worker starts awaiting.
  const status = await clickOption(escalation.id, 'b', 'need it shared across instances');
  check('decide route returned 200', status === 200, `status=${status}`);

  const result = await awaiting;
  log(`\nPhase 3 — worker resumes from the relayed decision`);
  check('await resolved (not timed out)', result.decided === true && result.timedOut === false);
  check('worker received the chosen option', result.optionId === 'b', `optionId=${result.optionId}`);
  check('worker received the note', result.note === 'need it shared across instances', `note=${result.note}`);

  // --- Phase 4: escalation auto-resolves off the inbox ---
  log(`\nPhase 4 — escalation resolves`);
  check('decision persisted', getEscalationDecision(escalation.id)?.optionId === 'b');
  check('escalation marked decided', getEscalation(escalation.id)?.status === 'decided', `status=${getEscalation(escalation.id)?.status}`);
  check('escalation off the open inbox', !listOpenEscalations().some((e) => e.id === escalation.id));

  // --- Guard: a bad option id is rejected (the card only sends real ids) ---
  log(`\nPhase 5 — guard: invalid option id is rejected`);
  const { escalation: e2 } = createEscalation({
    project: '/smoke/ed', session: 'worker-deadbeef', kind: 'decision',
    questionText: 'second decision', options: [{ id: 'x', label: 'X' }],
  });
  check('bad optionId → 400', (await clickOption(e2.id, 'not-a-real-option')) === 400);
  check('rejected escalation stays open', getEscalation(e2.id)?.status === 'open');
} finally {
  log(`\nCleanup`);
  if (existsSync(supDir)) { rmSync(supDir, { recursive: true, force: true }); log(`  🧹 removed isolated supervisor.db`); }
}

log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
