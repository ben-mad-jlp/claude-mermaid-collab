/**
 * JudgmentLLM port — the daemon's reasoning LLM behind a small swappable seam.
 *
 * The Orchestrator daemon's triage classifier (grok-triage.ts) calls a single
 * reasoning LLM to bucket an escalation. Historically that was hard-wired to
 * xAI/grok. This port makes the provider+model swappable (xai | openai |
 * anthropic) via three thin hand-rolled fetch clients (no SDK):
 *  - xAI + OpenAI share the OpenAI-style POST /v1/chat/completions shape.
 *  - Anthropic uses POST /v1/messages with the `anthropic-version` header.
 *
 * The xAI path is byte-equivalent to the previous realCallGrok in grok-triage.ts
 * (same URL, body shape, model field, message format, error handling) so the
 * DEFAULT behaviour is unchanged until a user picks a different provider.
 */

import { buildNodeArgv, parseNodeJson } from '../agent/node-invoker.ts';

export interface JudgmentLLM {
  complete(system: string, user: string): Promise<string>;
}

export type JudgmentProvider = 'xai' | 'openai' | 'anthropic' | 'claude';

/** Token usage surfaced from a judgment call (side-channel — `complete` still returns just the
 *  string). Fed to the spend ledger so triage/digest LLM burn is tracked like every other call. */
export interface JudgmentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface JudgmentConfig {
  provider: JudgmentProvider;
  model: string;
  /** API key for the keyed providers (xai/openai/anthropic). Unused by 'claude' (subscription). */
  apiKey: string;
  /** TRUSTED cwd for the 'claude' (subscription) provider's `claude -p` spawn. Defaults to
   *  process.cwd(); set to the project being triaged so the CLI trusts the folder. */
  cwd?: string;
  /** Best-effort usage sink — called once per successful `complete` with the call's token usage so
   *  the caller can ledger it (spend-ledger). Never throws into the completion. */
  onUsage?: (u: JudgmentUsage) => void;
}

/** Extract usage from an OpenAI-style chat/completions response. */
function openAiStyleUsage(data: any): JudgmentUsage {
  const u = data?.usage ?? {};
  const cached = (u.prompt_tokens_details?.cached_tokens ?? 0) as number;
  return {
    inputTokens: (u.prompt_tokens ?? 0) as number,
    outputTokens: (u.completion_tokens ?? 0) as number,
    cacheReadTokens: cached,
  };
}

/** Extract usage from an Anthropic /v1/messages response. */
function anthropicUsage(data: any): JudgmentUsage {
  const u = data?.usage ?? {};
  return {
    inputTokens: (u.input_tokens ?? 0) as number,
    outputTokens: (u.output_tokens ?? 0) as number,
    cacheReadTokens: (u.cache_read_input_tokens ?? 0) as number,
    cacheCreationTokens: (u.cache_creation_input_tokens ?? 0) as number,
  };
}

/** Fire an onUsage sink without ever letting it break the completion. */
function emitUsage(onUsage: ((u: JudgmentUsage) => void) | undefined, u: JudgmentUsage): void {
  if (!onUsage) return;
  try { onUsage(u); } catch { /* usage sink is best-effort */ }
}

const OPENAI_STYLE_BASE: Record<'xai' | 'openai', string> = {
  xai: 'https://api.x.ai/v1',
  openai: 'https://api.openai.com/v1',
};

/** Hard cap on a judgment call. These run INSIDE the orchestrator triage pass, so an
 *  unbounded HTTP fetch or `claude -p` spawn (e.g. during a network outage, where a
 *  socket stalls forever) would hang the whole tick and wedge the daemon. Every path
 *  below is bounded by this. */
const JUDGMENT_TIMEOUT_MS = 120_000;
/** After SIGTERM, grace before SIGKILL for the subscription `claude -p` spawn. */
const JUDGMENT_KILL_GRACE_MS = 3_000;

/** xAI / OpenAI: identical OpenAI-style chat/completions request + parse. */
function makeOpenAIStyle(base: string, model: string, apiKey: string, label: string, onUsage?: (u: JudgmentUsage) => void): JudgmentLLM {
  return {
    async complete(system: string, user: string): Promise<string> {
      if (!apiKey) throw new Error(`${label} API key is not set`);
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(JUDGMENT_TIMEOUT_MS), // never hang the triage pass on a stalled socket
      });
      if (!res.ok) throw new Error(`${label} API error ${res.status}`);
      const data = (await res.json()) as any;
      emitUsage(onUsage, openAiStyleUsage(data));
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

/** Anthropic: POST /v1/messages with x-api-key + anthropic-version header. */
function makeAnthropic(model: string, apiKey: string, onUsage?: (u: JudgmentUsage) => void): JudgmentLLM {
  return {
    async complete(system: string, user: string): Promise<string> {
      if (!apiKey) throw new Error('Anthropic API key is not set');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(JUDGMENT_TIMEOUT_MS), // never hang the triage pass on a stalled socket
      });
      if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
      const data = (await res.json()) as any;
      emitUsage(onUsage, anthropicUsage(data));
      // Anthropic returns content as an array of blocks; concat the text blocks.
      const content = data.content;
      if (Array.isArray(content)) {
        return content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('');
      }
      return '';
    },
  };
}

/**
 * Subscription provider: run `claude -p` — the SAME auth the leaf-executor uses — instead
 * of a paid API key. A pure completion: no tools (allowedTools ''), system via
 * --append-system-prompt, the user prompt on stdin; parse the stream-json result text.
 * `cwd` must be a TRUSTED folder (else the CLI's trust prompt swallows the run).
 */
function makeClaudeSubscription(model: string | undefined, cwd: string, onUsage?: (u: JudgmentUsage) => void): JudgmentLLM {
  return {
    async complete(system: string, user: string): Promise<string> {
      const argv = buildNodeArgv({
        prompt: user,
        cwd,
        allowedTools: '', // pure completion, no tools
        appendSystemPrompt: system || undefined,
        model: model || undefined,
        permissionMode: 'bypassPermissions',
      });
      const proc = Bun.spawn(argv, { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
      proc.stdin.write(user);
      proc.stdin.end();
      // Drain CONCURRENTLY, then BOUND the wait — same un-hangable pattern as the
      // leaf node-invoker. Without this, an outage stalls the read and the pipe never
      // EOFs, hanging the triage pass (this is the DEFAULT judgment provider) → the
      // whole orchestrator tick wedges. Escalate SIGTERM → SIGKILL on timeout.
      const outP = new Response(proc.stdout).text().catch(() => '');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          try { proc.kill(); } catch { /* gone */ }
          hardTimer = setTimeout(() => { try { proc.kill(9); } catch { /* gone */ } }, JUDGMENT_KILL_GRACE_MS);
          resolve();
        }, JUDGMENT_TIMEOUT_MS);
      });
      await Promise.race([proc.exited.then(() => undefined), timeout]);
      const capped = <T>(p: Promise<T>, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 5_000))]);
      const out = await capped(outP, '');
      await capped(proc.exited, -1);
      if (timer) clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      const parsed = parseNodeJson(out);
      if (parsed.parseError) throw new Error(`claude -p judgment failed: ${parsed.parseError}`);
      emitUsage(onUsage, {
        inputTokens: parsed.usage?.inputTokens,
        outputTokens: parsed.usage?.outputTokens,
        cacheReadTokens: parsed.usage?.cacheReadTokens,
        cacheCreationTokens: parsed.usage?.cacheCreationTokens,
      });
      return parsed.text ?? '';
    },
  };
}

/** Build a JudgmentLLM for the configured provider. */
export function makeJudgmentLLM(cfg: JudgmentConfig): JudgmentLLM {
  switch (cfg.provider) {
    case 'xai':
      return makeOpenAIStyle(OPENAI_STYLE_BASE.xai, cfg.model, cfg.apiKey, 'xAI', cfg.onUsage);
    case 'openai':
      return makeOpenAIStyle(OPENAI_STYLE_BASE.openai, cfg.model, cfg.apiKey, 'OpenAI', cfg.onUsage);
    case 'anthropic':
      return makeAnthropic(cfg.model, cfg.apiKey, cfg.onUsage);
    case 'claude':
      return makeClaudeSubscription(cfg.model, cfg.cwd ?? process.cwd(), cfg.onUsage);
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`Unknown judgment provider: ${String(_exhaustive)}`);
    }
  }
}
