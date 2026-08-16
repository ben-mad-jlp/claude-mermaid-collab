/**
 * The conductor is the ONLY reasoning node kind whose output was thrown away.
 *
 * Measured on the live worker-ledger (2026-08-14), rows / rows-with-outputText / output tokens:
 *   implement 3763/3587/40.6M · blueprint 3290/3221/42.2M · review 3173/3013/9.8M ·
 *   research 976/928/7.1M · conductor 1521/ZERO/11.0M · node 835/ZERO/2.7M
 * ~13.7M output tokens of reasoning generated and discarded. The `outputText` column already
 * existed and was already populated for every LEAF kind — the invokeNode auto-ledger boundary
 * (which is what conductor/node/planner/forge write through) simply never forwarded it.
 *
 * The cost was concrete: mission 949dda42 wedged when a conductor pass ran 253s of Opus for
 * 15,921 output tokens, exited 0, and filed NOTHING (filed:[], carried 0) while three criteria
 * sat at `discover`. Because nothing was filed the debounce fingerprint never changed, so every
 * later pass declined "fingerprint unchanged" forever — and there was no record ANYWHERE of what
 * the conductor concluded or why it filed nothing.
 *
 * Two layers pinned here:
 *   1. worker_ledger.outputText is populated for a conductor node run.
 *   2. conductor_pass.summary carries a SHORT node-authored account on every pass that RAN a
 *      node — above all the rows that look inert (an empty conduct) — and stays null (never
 *      fabricated) on a pass that was debounced without running one.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

let SUP_DIR: string;

beforeEach(() => {
  SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-reasoning-sup-'));
  process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
});

import { runConductorPass, extractPassSummary, CONDUCTOR_SUMMARY_LABEL, buildConductorPrompt } from '../conductor-pass';
import {
  listConductorPasses,
  openPassRow,
  appendPassProgress,
  clampPassSummary,
  CONDUCTOR_PASS_SUMMARY_MAX_CHARS,
  _closeConductorJournalDb,
} from '../conductor-pass-journal';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, listMissions, listCriteriaWithActions, isMissionTerminal } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo } from '../todo-store';
import { queryLedger, _closeLedgerDb } from '../worker-ledger';
import { invokeNode, _resetAuthCache, _resetClaudeBinCache, _primeAuthCacheForTest } from '../../agent/node-invoker';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-reasoning-'));
  _resetMissionDbCache(project);
  _closeConductorJournalDb();
  _closeLedgerDb();
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

/** An invoke spy that SERVES every discover gap (a productive pass). */
function servingInvoke(text: string) {
  return async () => {
    const m = listMissions(project).find((x) => x.mission.active && !isMissionTerminal(x.mission));
    if (m) {
      for (const c of listCriteriaWithActions(project, m.node.id).filter((x) => x.action === 'discover')) {
        await createTodo(project, { ownerSession: 's1', title: `[EPIC] served ${c.id}`, kind: 'epic', parentId: m.node.id, servesCriterionIds: [c.id] });
      }
    }
    return { ok: true, rateLimited: false, text } as any;
  };
}

/** An invoke spy that returns ok but files NOTHING — the 949dda42 wedge shape. */
function emptyConductInvoke(text: string | undefined) {
  return async () => ({ ok: true, rateLimited: false, exitCode: 0, timedOut: false, text } as any);
}

// ---------------------------------------------------------------------------
// LAYER 1 — worker_ledger.outputText
// ---------------------------------------------------------------------------

describe('layer 1: a conductor node run records its final message in worker_ledger.outputText', () => {
  let stubDir: string;
  let testCwd: string;

  beforeEach(() => {
    _resetAuthCache();
    _resetClaudeBinCache();
    testCwd = mkdtempSync(join(tmpdir(), 'conductor-reasoning-cwd-'));
    mkdirSync(testCwd, { recursive: true });
    stubDir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    // invokeNode spawns the node detached; the hermetic tripwire preload blocks that unless allowed.
    process.env.MERMAID_TEST_ALLOW_DETACHED = '1';
  });

  afterEach(() => {
    delete process.env.CLAUDE_BIN;
    delete process.env.MERMAID_TEST_ALLOW_DETACHED;
    _resetAuthCache();
    _resetClaudeBinCache();
    try { rmSync(stubDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { rmSync(testCwd, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test('the invokeNode auto-ledger boundary persists result.text (was always NULL)', async () => {
    _primeAuthCacheForTest('subscription');
    const finalMessage =
      'Grounded all three discover criteria against src/. Two are already built and landed; the third has no owner.\n' +
      `${CONDUCTOR_SUMMARY_LABEL} Filed nothing: two criteria are already satisfied by landed code and the third is blocked on a base-red epic.`;
    const stub = join(stubDir, 'claude-stub');
    writeFileSync(
      stub,
      '#!/bin/sh\ncat > /dev/null\n' +
        `printf '%s\\n' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: finalMessage, usage: { input_tokens: 10, output_tokens: 15921 } }).replace(/'/g, "'\\''")}'\n`,
      { mode: 0o755 },
    );
    chmodSync(stub, 0o755);
    process.env.CLAUDE_BIN = stub;

    const res = await invokeNode({
      prompt: 'conduct',
      cwd: testCwd,
      project,
      timeoutMs: 30_000,
      transcriptLabel: 'conductor',
      ledgerTodoId: 'mission-949dda42',
      ledgerSession: 'sess-A',
    });
    expect(res.text).toBe(finalMessage);

    const rows = queryLedger({ project }).filter((r) => r.nodeKind === 'conductor');
    expect(rows.length).toBe(1);
    // THE REGRESSION: this was null on every one of 1521 measured conductor rows.
    expect(rows[0].outputText).toBeTruthy();
    expect(rows[0].outputText).toContain('blocked on a base-red epic');
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 — conductor_pass.summary
// ---------------------------------------------------------------------------

describe('layer 2: conductor_pass.summary', () => {
  test('a pass that RAN a node and filed NOTHING still carries a non-null summary (the 949dda42 wedge row)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    const r = await runConductorPass(project, {
      invoke: emptyConductInvoke(
        'I read every criterion and could not find a safe decomposition.\n' +
          `${CONDUCTOR_SUMMARY_LABEL} Filed nothing — the only discover criterion depends on an epic whose base gate is red, so planning it now would burn a serving slot.`,
      ),
    });
    // ok:true but nothing served ⇒ the productive-pass guard treats it as node-failed.
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('node-failed');

    const row = listConductorPasses(project)[0];
    expect(row.ran).toBe(true);
    expect(row.filed).toEqual([]);
    expect(row.summary).not.toBeNull();
    expect(row.summary).toContain('base gate is red');
  });

  test('a productive pass carries the summary too', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    const r = await runConductorPass(project, {
      invoke: servingInvoke(`${CONDUCTOR_SUMMARY_LABEL} Served the one discover gap with a single right-sized epic.`),
    });
    expect(r.reason).toBe('conducted');
    expect(listConductorPasses(project)[0].summary).toBe('Served the one discover gap with a single right-sized epic.');
  });

  test('a node that ran but returned NO final message records the fact, not a fabrication', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    await runConductorPass(project, { invoke: emptyConductInvoke(undefined) });
    const row = listConductorPasses(project)[0];
    expect(row.ran).toBe(true);
    expect(row.summary).toContain('no final message');
  });

  test('a pass DEBOUNCED without running a node has a null summary and fabricates nothing', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    const text = `${CONDUCTOR_SUMMARY_LABEL} Served the gap.`;
    await runConductorPass(project, { invoke: servingInvoke(text) });
    const r2 = await runConductorPass(project, { invoke: servingInvoke(text) });
    expect(r2.reason).toBe('debounced');
    expect(r2.ran).toBe(false);

    const rows = listConductorPasses(project); // newest-first
    expect(rows[0].outcome).toBe('debounced');
    expect(rows[0].summary).toBeNull();
    // …while the pass that DID run a node kept its reasoning.
    expect(rows[1].summary).toBe('Served the gap.');
  });

  test('listConductorPasses surfaces the summary field (the read verb a watcher calls)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    await runConductorPass(project, { invoke: servingInvoke(`${CONDUCTOR_SUMMARY_LABEL} Done.`) });

    const rows = listConductorPasses(project, { limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'summary')).toBe(true);
    expect(rows[0].summary).toBe('Done.');
  });

  test('legacy rows predating the column read back as null without error (additive migration)', () => {
    // Write a conductor_pass table with the PRE-summary schema, exactly as an old install has it.
    const legacy = new Database(join(SUP_DIR, 'worker-ledger.db'));
    legacy.exec(`CREATE TABLE IF NOT EXISTS conductor_pass (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, missionId TEXT, startedAt INTEGER NOT NULL,
      endedAt INTEGER, serveFp TEXT, passFp TEXT, selfFp TEXT, arm TEXT, criteriaActed TEXT,
      filed TEXT, declined TEXT, outcome TEXT, ran INTEGER, failCounted INTEGER, carried TEXT)`);
    legacy.prepare(
      `INSERT INTO conductor_pass (id, project, missionId, startedAt, endedAt, arm, criteriaActed, filed, declined, outcome, ran)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('legacy-1', project, 'mission-old', 1000, 2000, 'node', '[]', '[]', '[]', 'conducted', 1);
    const cols = legacy.query('PRAGMA table_info(conductor_pass)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'summary')).toBe(false);
    legacy.close();

    _closeConductorJournalDb();
    const rows = listConductorPasses(project);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('legacy-1');
    expect(rows[0].outcome).toBe('conducted');
    expect(rows[0].summary).toBeNull();
  });

  test('the summary is truncated to the documented bound when the node output is huge', () => {
    const rowId = openPassRow(project, 'm1', Date.now());
    expect(rowId).not.toBeNull();
    const huge = 'x'.repeat(CONDUCTOR_PASS_SUMMARY_MAX_CHARS * 10);
    appendPassProgress(rowId!, { summary: huge });

    const row = listConductorPasses(project)[0];
    expect(row.summary!.length).toBe(CONDUCTOR_PASS_SUMMARY_MAX_CHARS);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('extractPassSummary / clampPassSummary (pure)', () => {
  test('prefers the LAST labelled line the node emitted', () => {
    const text = [
      `${CONDUCTOR_SUMMARY_LABEL} an early draft`,
      'more reasoning',
      `${CONDUCTOR_SUMMARY_LABEL} the real conclusion`,
    ].join('\n');
    expect(extractPassSummary(text)).toBe('the real conclusion');
  });

  test('falls back to the TAIL of an unlabelled final message (the conclusion, not the preamble)', () => {
    const text = 'A'.repeat(CONDUCTOR_PASS_SUMMARY_MAX_CHARS) + 'THE-CONCLUSION';
    const s = extractPassSummary(text);
    expect(s.length).toBe(CONDUCTOR_PASS_SUMMARY_MAX_CHARS);
    expect(s.endsWith('THE-CONCLUSION')).toBe(true);
  });

  test('an empty final message yields a factual marker naming the exit conditions', () => {
    expect(extractPassSummary('', { exitCode: 0, timedOut: false })).toBe(
      '(node ran but produced no final message; exitCode=0, timedOut=false)',
    );
  });

  test('clampPassSummary returns null for blank/absent input — an absent summary stays absent', () => {
    expect(clampPassSummary(null)).toBeNull();
    expect(clampPassSummary(undefined)).toBeNull();
    expect(clampPassSummary('   \n ')).toBeNull();
    expect(clampPassSummary('  kept  ')).toBe('kept');
  });

  test('the conductor prompt asks for the labelled summary line', () => {
    const p = buildConductorPrompt('/proj', 'm1', 'Ship the thing', 'sess-A');
    expect(p).toContain(CONDUCTOR_SUMMARY_LABEL);
  });
});
