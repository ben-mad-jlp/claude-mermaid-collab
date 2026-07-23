import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// Source-text audit of src/agent/worktree-manager.ts's main-checkout wrapping.
// Deliberately reads the file as TEXT rather than importing WorktreeManager —
// this is a shape audit, not a runtime behaviour test.
const SRC = readFileSync(
  path.resolve(import.meta.dir, '../../agent/worktree-manager.ts'),
  'utf8',
);

interface MethodInfo {
  line: number; // 1-based line number of the signature
  body: string; // brace-balanced body, signature line through closing brace line (inclusive)
  isPrivate: boolean;
}

/** Brace-balance a class member starting at a `  private/public? async? name(` line,
 *  scanning from the signature line to the matching closing `}` of the method body.
 *  A naive "next signature" split folds trailing private inners into the public
 *  body and produces false positives — balanced extraction is required. */
function methodBodies(src: string): Map<string, MethodInfo> {
  const lines = src.split('\n');
  const sigRe = /^ {2}(private |public )?(async )?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const result = new Map<string, MethodInfo>();

  for (let i = 0; i < lines.length; i++) {
    const m = sigRe.exec(lines[i]);
    if (!m) continue;
    const isPrivate = m[1] === 'private ';
    const name = m[3];

    // Phase 1: consume the parameter list — track PAREN depth (not brace depth) from
    // the signature's opening `(` until it closes. Param type annotations can contain
    // object-literal-shaped types (`opts?: { a?: number }`) whose braces balance to 0
    // mid-params; counting braces from the signature line would stop there instead of
    // at the real method body. So skip past the params using paren balance first.
    let parenDepth = 0;
    let seenParenOpen = false;
    let paramsEndLine = -1;
    let paramsEndCol = -1;
    outerParen: for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '(') {
          parenDepth++;
          seenParenOpen = true;
        } else if (ch === ')') {
          parenDepth--;
        }
        if (seenParenOpen && parenDepth === 0) {
          paramsEndLine = j;
          paramsEndCol = c + 1;
          break outerParen;
        }
      }
    }
    if (paramsEndLine === -1) continue; // malformed

    // Phase 2: from just past the closing `)` of the params, find the body's opening
    // `{`. A return-type annotation can itself contain balanced braces
    // (`Promise<{ removed: boolean }>`), so brace-counting from paramsEnd would stop
    // there instead of at the real body. Instead find the line whose remainder (after
    // stripping the return type) ENDS with `{` — this codebase's formatting always
    // places the body-opening brace as the last non-whitespace char of the signature.
    let bodyStartLine = -1;
    let bodyStartCol = -1;
    for (let j = paramsEndLine; j < lines.length; j++) {
      const line = j === paramsEndLine ? lines[j].slice(paramsEndCol) : lines[j];
      const trimmed = line.trimEnd();
      if (trimmed.endsWith('{')) {
        bodyStartLine = j;
        bodyStartCol = (j === paramsEndLine ? paramsEndCol : 0) + trimmed.length - 1;
        break;
      }
    }
    if (bodyStartLine === -1) continue; // malformed

    let braceDepth = 0;
    let seenBraceOpen = false;
    let endLine = -1;
    scanBrace: for (let j = bodyStartLine; j < lines.length; j++) {
      const line = lines[j];
      const startCol = j === bodyStartLine ? bodyStartCol : 0;
      for (let c = startCol; c < line.length; c++) {
        const ch = line[c];
        if (ch === '{') {
          braceDepth++;
          seenBraceOpen = true;
        } else if (ch === '}') {
          braceDepth--;
        }
        if (seenBraceOpen && braceDepth === 0) {
          endLine = j;
          break scanBrace;
        }
      }
    }
    if (endLine === -1) continue; // malformed / not a method body we can balance

    const body = lines.slice(i, endLine + 1).join('\n');
    result.set(name, { line: i + 1, body, isPrivate });
  }
  return result;
}

const METHODS = methodBodies(SRC);

const WRAPPED: Array<{ method: string; opName: string; inner: string }> = [
  { method: 'ensure', opName: 'ensure_session_worktree', inner: '_ensureInner' },
  { method: 'ensureEpic', opName: 'ensure_epic_worktree', inner: '_ensureEpicInner' },
  {
    method: 'forwardIntegrateEpic',
    opName: 'forward_integrate',
    inner: '_forwardIntegrateEpicInner',
  },
  { method: 'landEpicToMaster', opName: 'land_epic', inner: '_landEpicToMasterInner' },
  { method: 'removeEpic', opName: 'epic_gc_remove', inner: '_removeEpicInner' },
  {
    method: 'removeEpicWorktree',
    opName: 'epic_gc_remove_worktree',
    inner: '_removeEpicWorktreeInner',
  },
];

const EXEMPT: Record<string, string> = {
  renameEpicBranchToDropped:
    "runs 'worktree prune' + 'branch -m' in the main checkout — ref-only, never moves HEAD or touches the working tree.",
  listRegisteredPaths: "runs 'worktree list --porcelain' — read-only.",
};

const MUTATING_VERBS = new Set(['worktree', 'reset', 'checkout', 'merge', 'update-ref']);

/** Extract [verb, arg2] pairs for every `runGit(this.opts.projectRoot, [...])` call in a
 *  method body (the call may wrap across lines), then classify each as mutating/read-only. */
function projectRootGitArgvs(body: string): Array<{ verb: string; arg2: string | null }> {
  const out: Array<{ verb: string; arg2: string | null }> = [];
  const re = /runGit\(\s*this\.opts\.projectRoot\s*,\s*\[\s*'([^']*)'\s*(?:,\s*'([^']*)')?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ verb: m[1], arg2: m[2] ?? null });
  }
  return out;
}

function isMutating(call: { verb: string; arg2: string | null }): boolean {
  if (!MUTATING_VERBS.has(call.verb)) return false;
  if (call.verb === 'worktree' && call.arg2 === 'list') return false; // read-only
  return true;
}

describe('main-checkout wrap audit', () => {
  describe('A. every wrapped entrypoint delegates through the wrapper', () => {
    for (const { method, inner } of WRAPPED) {
      test(`${method} wraps and delegates to ${inner}`, () => {
        const pub = METHODS.get(method);
        expect(pub, `public method ${method} not found`).toBeDefined();
        const missing: string[] = [];
        if (!pub!.body.includes('withMainCheckoutInvariant(')) missing.push('withMainCheckoutInvariant(');
        if (!pub!.body.includes('this.opts.projectRoot')) missing.push('this.opts.projectRoot');
        if (!pub!.body.includes('this.mainCheckoutGit')) missing.push('this.mainCheckoutGit');
        if (!pub!.body.includes(`this.${inner}(`)) missing.push(`this.${inner}(`);
        expect(missing, `${method} missing: ${missing.join(', ')}`).toEqual([]);

        const priv = METHODS.get(inner);
        expect(priv, `private inner ${inner} not found`).toBeDefined();
        expect(priv!.isPrivate, `${inner} must be private`).toBe(true);
        expect(priv!.body.startsWith(`  private async ${inner}(`)).toBe(true);
      });
    }
  });

  describe('B. exactly six wrap sites, distinct opNames, handler on every one', () => {
    const siteRe = /withMainCheckoutInvariant\(/g;
    const siteCount = (SRC.match(siteRe) ?? []).length;

    test('exactly 6 withMainCheckoutInvariant( call sites', () => {
      expect(siteCount).toBe(6);
    });

    test('each site carries an explicit opName and onViolation, opNames form the expected 6-element set', () => {
      const opNames: string[] = [];
      const offenders: string[] = [];

      for (const { method } of WRAPPED) {
        const info = METHODS.get(method);
        expect(info, `public method ${method} not found`).toBeDefined();
        const body = info!.body;

        const optsMatch = /\{\s*opName:\s*'([^']*)'\s*,\s*onViolation:\s*this\.onMainCheckoutViolation\s*\}/.exec(
          body,
        );
        if (!optsMatch) {
          // Locate the enclosing wrap-site line for the failure message.
          const relIdx = body.indexOf('withMainCheckoutInvariant(');
          const siteLine =
            relIdx === -1 ? info!.line : info!.line + body.slice(0, relIdx).split('\n').length - 1;
          offenders.push(
            `wrap site in ${method} (line ${siteLine}) has no explicit opName — it would fall back to 'operation'`,
          );
          continue;
        }
        opNames.push(optsMatch[1]);
      }

      expect(offenders, offenders.join('; ')).toEqual([]);
      expect(new Set(opNames).size).toBe(6);
      expect(new Set(opNames)).toEqual(new Set(WRAPPED.map((w) => w.opName)));
    });
  });

  describe('C. default handler is the escalation', () => {
    test('onMainCheckoutViolation defaults to escalateMainCheckoutViolation', () => {
      expect(
        /onMainCheckoutViolation\s*=\s*opts\.onMainCheckoutViolation\s*\?\?\s*escalateMainCheckoutViolation/.test(
          SRC,
        ),
      ).toBe(true);
    });

    test('escalateMainCheckoutViolation is imported from ../services/main-checkout-escalation', () => {
      expect(
        /import\s*\{\s*escalateMainCheckoutViolation\s*\}\s*from\s*'\.\.\/services\/main-checkout-escalation'/.test(
          SRC,
        ),
      ).toBe(true);
    });
  });

  describe('D. growth guard: every mutating projectRoot git op is wrapped or exempt', () => {
    const wrappedMethods = new Set(WRAPPED.map((w) => w.method));

    test('every public method with a mutating projectRoot git call is in WRAPPED or EXEMPT', () => {
      const offenders: string[] = [];
      for (const [name, info] of METHODS) {
        if (info.isPrivate) continue;
        if (name.startsWith('_')) continue;
        if (wrappedMethods.has(name) || name in EXEMPT) continue;

        const calls = projectRootGitArgvs(info.body);
        const mutating = calls.some(isMutating);
        if (mutating) {
          offenders.push(
            `${name} (line ${info.line}) runs a mutating git op in the main checkout but is neither wrapped nor EXEMPT`,
          );
        }
      }
      expect(offenders, offenders.join('; ')).toEqual([]);
    });

    test('every EXEMPT key resolves to an existing public method', () => {
      for (const name of Object.keys(EXEMPT)) {
        const info = METHODS.get(name);
        expect(info, `EXEMPT method ${name} not found`).toBeDefined();
        expect(info!.isPrivate, `EXEMPT method ${name} must be public`).toBe(false);
      }
    });
  });
});
