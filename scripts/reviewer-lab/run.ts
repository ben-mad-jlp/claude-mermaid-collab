/**
 * reviewer-lab — faithful test harness for the daemon's FLOOR REVIEW NODE.
 *
 * For each corpus case it:
 *   1. builds an isolated git repo: base commit, then the "after" (implemented) tree as
 *      working-tree changes (new files intent-to-added, matching stageUntrackedIntentToAdd),
 *   2. runs the REAL review-node prompt (buildNodePrompt('review', leaf, blueprint)) via
 *      `claude -p` with the REAL review NodeSpec flags (buildNodeArgv), model opus / effort high,
 *      read-only tools — byte-identical to what the executor spawns,
 *   3. computes the NET reviewer verdict with the REAL gating fns (parseVerdict +
 *      validateReviewGrounding + isNonFalsifiableReviewDoubt), modelling the mech-GREEN arm,
 *   4. scores it against the case's expected accept/reject.
 *
 * Net-verdict model (mech gate GREEN — the interesting arm; full tier, no test-flip signal):
 *   PASS + grounding 'ok'                          -> accept
 *   PASS + grounding 'vacuous' (not all cmd-result)-> reject (vacuous retry/park)
 *   PASS + grounding 'abstain' (unreadable cs)     -> accept (defensive; rare)
 *   FAIL + non-falsifiable doubt (cs>0)            -> accept (abstain — do not gate)
 *   FAIL + falsifiable                             -> reject (gate)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildNodePrompt, parseVerdict, isNonFalsifiableReviewDoubt } from '../../src/services/leaf-executor';
import { validateReviewGrounding } from '../../src/services/review-citations';
import { uncitedCriteriaAreAllCommandResults } from '../../src/services/criteria-citability';
import { buildNodeArgv } from '../../src/agent/node-invoker';
import { CASES as EASY, type Case } from './cases';
import { HARD } from './cases-hard';
import { MEAN } from './cases-mean';
import { SONNET } from './cases-sonnet';
const CASES: Case[] = [...EASY, ...HARD, ...MEAN, ...SONNET];

const OUT = join(import.meta.dir, 'results');
mkdirSync(OUT, { recursive: true });

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function setupRepo(c: Case): { cwd: string; changeSet: string[] } {
  const cwd = mkdtempSync(join(tmpdir(), `revlab-${c.id}-`));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'lab@test']);
  git(cwd, ['config', 'user.name', 'lab']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
  // base tree
  for (const [p, content] of Object.entries(c.base)) {
    const abs = join(cwd, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  // apply "after" as working-tree changes
  const newFiles: string[] = [];
  for (const [p, content] of Object.entries(c.after)) {
    const abs = join(cwd, p);
    const existed = existsSync(abs);
    if (content === null) {
      if (existed) rmSync(abs);
      continue;
    }
    if (!existed) newFiles.push(p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  // intent-to-add new files so `git diff` shows them (mirrors stageUntrackedIntentToAdd)
  for (const p of newFiles) git(cwd, ['add', '-N', p]);
  // change-set = names in the working diff vs HEAD (tracked mods + intent-to-add + deletes)
  const changeSet = git(cwd, ['diff', '--name-only', 'HEAD'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  return { cwd, changeSet };
}

function makeCitationExists(cwd: string) {
  return (path: string, line: number): boolean => {
    try {
      const abs = join(cwd, path);
      if (!existsSync(abs)) return false;
      const n = require('node:fs').readFileSync(abs, 'utf8').split('\n').length;
      return line >= 1 && line <= n;
    } catch { return false; }
  };
}

function runReviewNode(cwd: string, prompt: string): Promise<{ text: string; raw: string }> {
  const spec = {
    prompt,
    // Default to the PRODUCTION config the user actually runs (sonnet/medium), overridable via env.
    // The NODE_PROFILE default is opus/high, but projects commonly override review → sonnet/medium.
    model: process.env.REVIEW_MODEL || 'sonnet',
    effort: (process.env.REVIEW_EFFORT || 'medium') as const,
    allowedTools: 'Read Grep Glob Bash',
    permissionMode: 'bypassPermissions' as const,
    strictMcpConfig: true,
  };
  const argv = buildNodeArgv(spec as any); // ['claude','-p',...] — same flags the executor uses
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
      // stream-json JSONL: final {"type":"result", ...} carries .result (the text)
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

/** The NET reviewer verdict, modelling the mech-GREEN arm of the executor gate. */
function netVerdict(reviewText: string, changeSet: string[], cwd: string): {
  net: 'accept' | 'reject'; verdict: string; grounding: string; doubt: boolean; reason: string;
} {
  const verdict = parseVerdict(reviewText);
  const citationExists = makeCitationExists(cwd);
  if (verdict === 'error') {
    return { net: 'reject', verdict, grounding: '-', doubt: false, reason: 'no parseable VERDICT line (park)' };
  }
  if (verdict === 'pass') {
    const g = validateReviewGrounding(reviewText, changeSet, { citationExists });
    if (g.status === 'ok' || g.status === 'abstain') {
      return { net: 'accept', verdict, grounding: g.status, doubt: false, reason: g.reasons[0] ?? 'grounded PASS' };
    }
    // vacuous — defer if all uncited criteria are command-results
    const defer = uncitedCriteriaAreAllCommandResults(g.criteria, changeSet);
    if (defer) return { net: 'accept', verdict, grounding: g.status, doubt: false, reason: 'vacuous but all-command-result → defer-to-evidence' };
    return { net: 'reject', verdict, grounding: g.status, doubt: false, reason: `vacuous PASS: ${g.reasons[0]}` };
  }
  // verdict === 'fail'
  const doubt = isNonFalsifiableReviewDoubt(reviewText);
  if (changeSet.length > 0 && doubt) {
    return { net: 'accept', verdict, grounding: '-', doubt, reason: 'FAIL is non-falsifiable doubt → ABSTAIN (do not gate)' };
  }
  return { net: 'reject', verdict, grounding: '-', doubt, reason: 'falsifiable FAIL → gate (reject)' };
}

async function runOne(c: Case) {
  const { cwd, changeSet } = setupRepo(c);
  const leaf: any = { id: c.id.padEnd(8, '0').slice(0, 8), title: c.title, description: c.description };
  const prompt = buildNodePrompt('review', leaf, c.blueprint);
  const { text } = await runReviewNode(cwd, prompt);
  const nv = netVerdict(text, changeSet, cwd);
  const correct = nv.net === c.expected;
  writeFileSync(join(OUT, `${c.id}.review.md`), text);
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  return { id: c.id, lang: c.lang, concept: c.concept, complexity: c.complexity, expected: c.expected, ...nv, correct, changeSet };
}

async function main() {
  const only = process.argv.slice(2);
  const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
  console.log(`running ${cases.length} case(s), concurrency 8 — review model=${process.env.REVIEW_MODEL || 'sonnet'} effort=${process.env.REVIEW_EFFORT || 'medium'}`);
  const results: any[] = [];
  const CONC = 8;
  let i = 0;
  async function worker() {
    while (i < cases.length) {
      const c = cases[i++];
      const t0 = Date.now();
      try {
        const r = await runOne(c);
        results.push(r);
        const mark = r.correct ? '✓' : '✗';
        console.log(`${mark} ${r.id.padEnd(26)} exp=${r.expected.padEnd(6)} got=${r.net.padEnd(6)} v=${String(r.verdict).padEnd(5)} g=${String(r.grounding).padEnd(8)} doubt=${r.doubt} (${((Date.now()-t0)/1000)|0}s)`);
      } catch (e) {
        console.log(`! ${c.id} ERROR ${(e as Error).message}`);
        results.push({ id: c.id, error: (e as Error).message, correct: false });
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));
  const correct = results.filter((r) => r.correct).length;
  const falseReject = results.filter((r) => !r.correct && r.expected === 'accept'); // over-rejection
  const falseAccept = results.filter((r) => !r.correct && r.expected === 'reject'); // missed bug
  const summary = { total: results.length, correct, accuracy: +(correct / results.length).toFixed(3),
    overRejections: falseReject.map((r) => r.id), missedBugs: falseAccept.map((r) => r.id), results };
  writeFileSync(join(OUT, `run.json`), JSON.stringify(summary, null, 2));
  console.log(`\n=== ${correct}/${results.length} correct (${summary.accuracy}) ===`);
  console.log(`OVER-REJECTIONS (correct code failed): ${summary.overRejections.join(', ') || 'none'}`);
  console.log(`MISSED BUGS (buggy code passed):       ${summary.missedBugs.join(', ') || 'none'}`);
}
main();
