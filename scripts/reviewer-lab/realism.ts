/** Realism capstone: run the REAL review node against a subtle correct change to a LARGE real
 *  file, in a full repo worktree (node_modules, tsconfig present), at sonnet/medium. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNodePrompt, parseVerdict, isNonFalsifiableReviewDoubt } from '../../src/services/leaf-executor';
import { validateReviewGrounding } from '../../src/services/review-citations';
import { buildNodeArgv } from '../../src/agent/node-invoker';

const WT = process.argv[2];
const git = (a: string[]) => execFileSync('git', a, { cwd: WT, encoding: 'utf8' });
const changeSet = git(['diff', '--name-only', 'HEAD']).split('\n').map(s => s.trim()).filter(Boolean);

const blueprint = [
  'ACCEPTANCE CRITERIA:',
  '- leafSessionKey throws a clear Error when leaf.id is empty/falsy, before building the lane key',
  '- for a real id the returned key is unchanged (leaf-exec-<first 8 hex>)',
  '',
  'A keyless leaf must never silently share the "leaf-exec-" lane with another keyless leaf.',
].join('\n');

const leaf: any = { id: 'realism1', title: 'Guard leafSessionKey against an empty leaf id', description: 'Throw on empty id.' };
const prompt = buildNodePrompt('review', leaf, blueprint);
const spec = { prompt, model: 'sonnet', effort: 'medium' as const, allowedTools: 'Read Grep Glob Bash', permissionMode: 'bypassPermissions' as const, strictMcpConfig: true };
const argv = buildNodeArgv(spec as any);

const child = spawn(argv[0], argv.slice(1), { cwd: WT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', () => {});
child.on('close', () => {
  let text = '';
  for (const line of out.split('\n')) { const t = line.trim(); if (!t.startsWith('{')) continue; try { const o = JSON.parse(t); if (o.type === 'result' && typeof o.result === 'string') text = o.result; } catch {} }
  const verdict = parseVerdict(text);
  const citationExists = (p: string, ln: number) => { try { const abs = join(WT, p); return existsSync(abs) && ln >= 1 && ln <= readFileSync(abs, 'utf8').split('\n').length; } catch { return false; } };
  const g = validateReviewGrounding(text, changeSet, { citationExists });
  let net = 'accept';
  if (verdict === 'error') net = 'reject(no-verdict)';
  else if (verdict === 'pass') net = (g.status === 'ok' || g.status === 'abstain') ? 'accept' : `reject(${g.status})`;
  else net = (changeSet.length > 0 && isNonFalsifiableReviewDoubt(text)) ? 'accept(abstain)' : 'reject(gate)';
  console.log('changeSet:', changeSet.join(', '));
  console.log('verdict:', verdict, '| grounding:', g.status, '| NET:', net, '| EXPECT: accept');
  console.log('\n===== REVIEW =====\n' + text);
});
child.stdin.write(prompt); child.stdin.end();
