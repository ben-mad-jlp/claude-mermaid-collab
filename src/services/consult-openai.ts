/**
 * Consult OpenAI service — hand-rolled fetch client for Codex.
 *
 * A second, independent opinion at design time — the OpenAI-backed twin of
 * consult_grok. Uses a separate service module so it can be unit-tested without
 * touching the 4000-line setup.ts dispatch. Injected deps allow tests to mock
 * fetch and getSecret without network calls or key leaks.
 *
 * The file is named for the PROVIDER (openai), the tool for the MODEL (codex).
 *
 * Design goals:
 * - Config.json-first key resolution (same as consult_grok / judgment-llm).
 * - Retry-once on transient infra failure only.
 * - Empty completion rejected with an error (not degraded to a verdict).
 * - Cost tallied from a local price table, returned in the usage object.
 * - API key never leaked in errors, logs, or return values.
 */

import { getSecret } from './config-service.js';

export const DEFAULT_CONSULT_CODEX_MODEL = 'gpt-5-codex';
export const OPENAI_KEY_NAME = 'OPENAI_API_KEY';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const CONSULT_TIMEOUT_MS = 120_000;

export interface ConsultCodexArgs {
  prompt: string;
  system?: string;
  model?: string;
}

export interface ConsultCodexResult {
  model: string;
  response: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    costUsd?: number | null;
    [k: string]: unknown;
  };
}

/**
 * OpenAI pricing per million tokens. Extended model-by-model when new models become available.
 * Prices are USD per 1e6 input (non-cached), cached input, and output tokens.
 *
 * A model absent from this table yields costUsd: null and a warning — never a
 * fabricated or zero cost. A silently-zero cost row is the same failure class as
 * a silently-passing gate: an unknown value read as a benign one.
 */
const OPENAI_PRICE: Record<string, { in: number; cachedIn: number; out: number }> = {
  'gpt-5': { in: 1.25, cachedIn: 0.125, out: 10 },
  'gpt-5-codex': { in: 1.25, cachedIn: 0.125, out: 10 },
  'gpt-5.3-codex': { in: 1.75, cachedIn: 0.175, out: 14 },
};

/** Models already warned about, so the warning fires once per model, not once per call. */
const warnedUnpricedModels = new Set<string>();

export interface ConsultCodexDeps {
  fetchImpl?: typeof fetch;
  getSecretImpl?: typeof getSecret;
}

/**
 * Consult Codex with a question or prompt. Handles key resolution, retries,
 * cost calculation, and strict key hygiene.
 *
 * @throws Error with 'Missing required: prompt' if prompt is missing.
 * @throws Error with key-resolution message if OPENAI_API_KEY is not set.
 * @throws Error with 'OpenAI API error...' if the HTTP response is not ok after retries.
 * @throws Error with 'OpenAI returned an empty completion...' if the reply is empty.
 * @throws Error with 'OpenAI API request failed (network): ...' on transient failure after retries.
 */
export async function consultCodex(
  args: ConsultCodexArgs,
  deps?: ConsultCodexDeps,
): Promise<ConsultCodexResult> {
  // Use injected implementations for testing; fall back to real ones
  const fetchFn = deps?.fetchImpl ?? fetch;
  const getSecretFn = deps?.getSecretImpl ?? getSecret;

  if (!args.prompt) {
    throw new Error('Missing required: prompt');
  }

  const model = args.model ?? DEFAULT_CONSULT_CODEX_MODEL;
  const apiKey = getSecretFn(OPENAI_KEY_NAME);

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it in Settings → Secrets (stored in ~/.mermaid-collab/config.json), or export OPENAI_API_KEY before starting the server.',
    );
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (args.system) {
    messages.push({ role: 'system', content: args.system });
  }
  messages.push({ role: 'user', content: args.prompt });

  // Retry-once on transient infra failure
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchFn(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(CONSULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        const raw = await response.text();
        let detail = raw;
        try {
          const parsed = JSON.parse(raw) as any;
          // OpenAI returns { error: { message } }
          detail = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : '') || parsed?.message || raw;
        } catch {
          /* non-JSON body — use raw text */
        }
        throw new Error(`OpenAI API error (${response.status} ${response.statusText}): ${detail || '(no body)'}`);
      }

      const data = (await response.json()) as any;
      const reply = data.choices?.[0]?.message?.content ?? '';

      if (!reply.trim()) {
        throw new Error(`OpenAI returned an empty completion (model=${model}) — this is an error, not a verdict.`);
      }

      // Calculate cost from usage + price table
      const costUsd = calculateCost(model, data.usage);

      return {
        model,
        response: reply,
        usage: { ...data.usage, costUsd },
      };
    } catch (e) {
      const err = e as Error;
      const errMsg = String(err);

      // Transient: fetch TypeError/AbortError, or 429/5xx response
      const isTransient =
        err instanceof TypeError ||
        err instanceof DOMException ||
        errMsg.includes('socket connection was closed unexpectedly') ||
        errMsg.includes('ECONNRESET') ||
        /OpenAI API error \((429|5\d\d) /.test(errMsg);  // 429 or 5xx status codes

      if (isTransient) {
        if (attempt === 1) {
          // Retry-once: wait ~750ms then loop to attempt 2
          lastError = err;
          await new Promise(resolve => setTimeout(resolve, 750));
          continue;
        } else {
          // Attempt 2 also failed with transient error
          lastError = err;
          break;
        }
      }

      // Not transient. Sanitize before throwing.
      const sanitized = errMsg.replaceAll(apiKey, '[redacted]');
      throw new Error(sanitized);
    }
  }

  // After both attempts failed with transient error
  if (lastError) {
    const sanitized = String(lastError).replaceAll(apiKey, '[redacted]');
    throw new Error(`OpenAI API request failed (network): ${sanitized}`);
  }

  throw new Error('OpenAI API request failed (unknown)');
}

/**
 * Calculate cost from usage stats + price table. Mirrors xai-api-invoker pattern.
 * If the model has no price entry, returns null (not a fabricated number) and says so.
 */
export function calculateCost(
  model: string,
  usage: Record<string, unknown> | undefined,
): number | null {
  if (!usage) return null;

  const priceEntry = OPENAI_PRICE[model];
  if (!priceEntry) {
    // Unknown model → no cost. Loud, not silent: an uncosted call must be visible.
    if (!warnedUnpricedModels.has(model)) {
      warnedUnpricedModels.add(model);
      console.warn(
        `[consult-openai] No price entry for model "${model}" — costUsd will be null. ` +
          `Add it to OPENAI_PRICE with the real published rates.`,
      );
    }
    return null;
  }

  const promptTokens = (usage.prompt_tokens ?? 0) as number;
  const promptDetails = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cachedTokens = (promptDetails.cached_tokens ?? 0) as number;
  const completionTokens = (usage.completion_tokens ?? 0) as number;

  const inputCost = (promptTokens - cachedTokens) * (priceEntry.in / 1_000_000);
  const cachedCost = cachedTokens * (priceEntry.cachedIn / 1_000_000);
  const outputCost = completionTokens * (priceEntry.out / 1_000_000);

  return inputCost + cachedCost + outputCost;
}
