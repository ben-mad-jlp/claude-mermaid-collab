/**
 * XaiApiNodeInvoker — a third NodeInvoker (alongside ClaudeNodeInvoker / GrokNodeInvoker)
 * that runs a node against the PUBLIC xAI API (`api.x.ai`) via the Vercel AI SDK, so it can
 * reach **grok-4.3** — xAI's flagship reasoner, which the `grok-build` CLI proxy CANNOT serve
 * (it only exposes the two coding models). Design + bake-off: doc `xai-api-node-invoker-design`.
 *
 * SCOPE: the validated win is REVIEW (and, by the reasoning-strength argument, blueprint).
 * grok-4.3 beat the CLI coding model as a reviewer (5/6 real bugs caught vs 4/6, 0 vs 2 false
 * positives, ~8× faster). The production review node is AGENTIC + READ-ONLY ("Read/Grep/Glob
 * and Bash for inspection ONLY; no edits"), so this invoker gives grok-4.3 a small READ-ONLY
 * tool loop (read_file / grep / list_dir / git read-subcommands) plus ONE scoped write
 * (write_report, restricted to docs/review/) for the completeness-review deliverable. There is
 * NO write/edit/mutating-bash surface — the daemon-unattended footguns (budget-exhausting
 * loops, accidental mutation) Grok's own consult flagged are designed out.
 *
 * Auth: XAI_API_KEY (fail-closed pre-flight `assertXaiApiAuth`). The API returns token counts,
 * so unlike the CLI grok lane (which reports $0) this records REAL per-node cost in the ledger.
 */
import { generateText, stepCountIs, tool } from 'ai';
import { xai } from '@ai-sdk/xai';
import { z } from 'zod';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureTranscript } from './node-invoker';
import type { NodeInvoker, NodeResult, NodeSpec, NodeUsage, AuthMode } from './node-invoker';

/** Default model for the xAI-API lane — the flagship reasoner (the bake-off winner). */
export const DEFAULT_XAI_API_MODEL = 'grok-4.3';
/** Step cap for the read-only loop. Review/blueprint rarely needs many tool turns; the cap is
 *  the daemon-unattended backstop so a pathological loop always terminates. */
export const XAI_API_STEP_CAP = 24;
const DEFAULT_TIMEOUT_MS = 600_000;
/** Per-Mtok prices for grok-4.3 on api.x.ai (verified via GET /v1/models): $1.25 in / $2.50
 *  out, cached input $0.20. Used to record REAL cost the CLI lane cannot. */
const XAI_PRICE = { in: 1.25, cachedIn: 0.2, out: 2.5 };
const READ_BYTES_CAP = 60_000;
const TOOL_OUT_CAP = 8_000;
/** git subcommands the loop may run — strictly read-only/inspection. */
const GIT_READONLY = new Set(['diff', 'show', 'log', 'status', 'ls-files', 'blame', 'rev-parse']);

// --- Auth (fail-closed, memoized; separate cache from claude/grok) -----------
let cachedXaiAuth: AuthMode | null = null;
export function resolveXaiApiAuthMode(): AuthMode {
  if (cachedXaiAuth === null) {
    cachedXaiAuth = (process.env.XAI_API_KEY?.trim() ?? '').length > 0 ? 'api' : 'unknown';
  }
  return cachedXaiAuth;
}
export function assertXaiApiAuth(): AuthMode {
  const m = resolveXaiApiAuthMode();
  if (m !== 'api') {
    throw new Error(
      "refusing to run xai-api nodes: XAI_API_KEY is missing/empty (expected the public api.x.ai key). " +
        'Set XAI_API_KEY in the environment or Secrets UI.',
    );
  }
  return m;
}
/** For tests: drop the memoized auth mode. */
export function _resetXaiApiAuthCache(): void {
  cachedXaiAuth = null;
}

function xaiParseError(msg: string): string {
  return msg.startsWith('xai:') ? msg : `xai: ${msg}`;
}

/** Rate-limit / connectivity classification from a thrown AI-SDK error. */
function classifyError(e: unknown): { rateLimited: boolean; unreachable: boolean } {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  const rateLimited = status === 429 || /\b429\b|rate.?limit|too many requests|quota|overloaded/.test(msg);
  const unreachable =
    !rateLimited &&
    /enotfound|econnrefused|econnreset|etimedout|eai_again|fetch failed|network|socket hang|getaddrinfo|tls|certificate/.test(msg);
  return { rateLimited, unreachable };
}

/** Resolve a model-supplied path INSIDE the worktree; reject traversal/escape. */
function safeResolve(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null; // escapes the worktree
  return abs;
}

/** Read-only (plus docs/review-scoped write) worktree tools for the review/blueprint loop. */
function buildReadOnlyTools(cwd: string) {
  const cap = (s: string) => (s.length > TOOL_OUT_CAP ? `${s.slice(0, TOOL_OUT_CAP)}\n…(truncated)` : s);
  return {
    read_file: tool({
      description: 'Read a UTF-8 file relative to the worktree root.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const abs = safeResolve(cwd, path);
        if (!abs) return 'ERROR: path escapes the worktree';
        if (!existsSync(abs)) return '(no such file)';
        try { return cap(readFileSync(abs, 'utf8').slice(0, READ_BYTES_CAP)); } catch (e) { return `ERROR: ${String(e)}`; }
      },
    }),
    grep: tool({
      description: 'Search file contents (regex) under the worktree. Returns matching lines with file:line.',
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path }) => {
        const sub = path ? safeResolve(cwd, path) : cwd;
        if (!sub) return 'ERROR: path escapes the worktree';
        const r = spawnSync('grep', ['-rnI', '--max-count=200', '-e', pattern, sub], { cwd, encoding: 'utf8' });
        return cap((r.stdout ?? '') || '(no matches)');
      },
    }),
    list_dir: tool({
      description: 'List tracked files under a directory (relative to the worktree root).',
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path }) => {
        const args = ['ls-files'];
        if (path) args.push('--', path);
        const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
        return cap((r.stdout ?? '') || '(empty)');
      },
    }),
    git: tool({
      description: 'Run a READ-ONLY git subcommand (diff, show, log, status, ls-files, blame, rev-parse). Use to inspect the change-set.',
      inputSchema: z.object({ args: z.array(z.string()) }),
      execute: async ({ args }) => {
        if (args.length === 0 || !GIT_READONLY.has(args[0])) {
          return `ERROR: only read-only git subcommands are allowed (${[...GIT_READONLY].join(', ')})`;
        }
        const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
        return cap(`exit=${r.status}\n${(r.stdout ?? '') + (r.stderr ?? '')}`);
      },
    }),
    write_report: tool({
      description: 'Write the review report markdown. ONLY paths under docs/review/ are allowed. Use this for the committed review deliverable.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const abs = safeResolve(cwd, path);
        if (!abs) return 'ERROR: path escapes the worktree';
        const rel = relative(cwd, abs);
        if (!rel.startsWith('docs/review/')) return 'ERROR: write_report is restricted to docs/review/';
        try {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content, 'utf8');
          return `wrote ${rel} (${content.length} bytes)`;
        } catch (e) { return `ERROR: ${String(e)}`; }
      },
    }),
  };
}

function priceCost(u: NodeUsage): number {
  const cached = u.cacheReadTokens ?? 0;
  const inp = Math.max(0, (u.inputTokens ?? 0) - cached);
  return (inp / 1e6) * XAI_PRICE.in + (cached / 1e6) * XAI_PRICE.cachedIn + ((u.outputTokens ?? 0) / 1e6) * XAI_PRICE.out;
}

/**
 * Run ONE bounded read-only xAI-API node (grok-4.3 by default). Mirrors invokeGrokNode's
 * NodeResult contract so the leaf-executor dispatch is uniform.
 */
export async function invokeXaiApiNode(spec: NodeSpec): Promise<NodeResult> {
  const start = Date.now();
  const authMode = resolveXaiApiAuthMode();
  if (authMode !== 'api') {
    const msg = xaiParseError("HALT: node refused — XAI_API_KEY missing/empty (expected api.x.ai key).");
    // eslint-disable-next-line no-console
    console.error(`[xai-api-invoker] ${msg}`);
    return { ok: false, exitCode: -1, stdout: '', durationMs: Math.round(Date.now() - start), rateLimited: false, authMode, parseError: msg };
  }

  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = spec.model && spec.model.startsWith('grok-') ? spec.model : DEFAULT_XAI_API_MODEL;

  try {
    const r = await generateText({
      model: xai(model),
      tools: buildReadOnlyTools(spec.cwd),
      stopWhen: stepCountIs(spec.maxTurns ?? XAI_API_STEP_CAP),
      system: spec.appendSystemPrompt,
      prompt: spec.prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
      temperature: 0,
    });

    const u = r.usage as { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | undefined;
    const usage: NodeUsage = {
      inputTokens: u?.inputTokens,
      outputTokens: u?.outputTokens,
      cacheReadTokens: u?.cachedInputTokens,
      numTurns: r.steps?.length,
    };
    usage.costUsd = priceCost(usage);

    const durationMs = Math.round(Date.now() - start);
    const text = r.text?.trim() ? r.text : undefined;
    const stdout = text ?? '';
    if (spec.transcriptPath) {
      captureTranscript(spec.transcriptPath, spec.transcriptLabel ?? 'xai-node', stdout, { exitCode: 0, durationMs });
    }
    // finishReason 'stop'/'tool-calls' are healthy ends; 'length' means truncated.
    const ok = text != null && r.finishReason !== 'error' && r.finishReason !== 'length';
    return {
      ok,
      exitCode: ok ? 0 : 1,
      stdout,
      durationMs,
      usage,
      rateLimited: false,
      authMode,
      text,
      parseError: ok ? undefined : xaiParseError(text == null ? 'model returned empty text' : `finishReason=${r.finishReason}`),
    };
  } catch (e) {
    const durationMs = Math.round(Date.now() - start);
    const { rateLimited, unreachable } = classifyError(e);
    const aborted = e instanceof Error && (e.name === 'AbortError' || /abort|timed? ?out/i.test(e.message));
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs,
      rateLimited: rateLimited || unreachable,
      unreachable: unreachable || undefined,
      authMode,
      parseError: xaiParseError(aborted ? `node timed out after ${timeoutMs}ms` : (e instanceof Error ? e.message : String(e))),
    };
  }
}

/** xAI-API (grok-4.3) read-only node invoker — wraps `invokeXaiApiNode`. */
export const XaiApiNodeInvoker: NodeInvoker = {
  invoke: invokeXaiApiNode,
};
