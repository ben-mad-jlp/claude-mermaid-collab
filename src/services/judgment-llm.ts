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

export interface JudgmentLLM {
  complete(system: string, user: string): Promise<string>;
}

export type JudgmentProvider = 'xai' | 'openai' | 'anthropic';

export interface JudgmentConfig {
  provider: JudgmentProvider;
  model: string;
  apiKey: string;
}

const OPENAI_STYLE_BASE: Record<'xai' | 'openai', string> = {
  xai: 'https://api.x.ai/v1',
  openai: 'https://api.openai.com/v1',
};

/** xAI / OpenAI: identical OpenAI-style chat/completions request + parse. */
function makeOpenAIStyle(base: string, model: string, apiKey: string, label: string): JudgmentLLM {
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
      });
      if (!res.ok) throw new Error(`${label} API error ${res.status}`);
      const data = (await res.json()) as any;
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

/** Anthropic: POST /v1/messages with x-api-key + anthropic-version header. */
function makeAnthropic(model: string, apiKey: string): JudgmentLLM {
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
      });
      if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
      const data = (await res.json()) as any;
      // Anthropic returns content as an array of blocks; concat the text blocks.
      const content = data.content;
      if (Array.isArray(content)) {
        return content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('');
      }
      return '';
    },
  };
}

/** Build a JudgmentLLM for the configured provider. */
export function makeJudgmentLLM(cfg: JudgmentConfig): JudgmentLLM {
  switch (cfg.provider) {
    case 'xai':
      return makeOpenAIStyle(OPENAI_STYLE_BASE.xai, cfg.model, cfg.apiKey, 'xAI');
    case 'openai':
      return makeOpenAIStyle(OPENAI_STYLE_BASE.openai, cfg.model, cfg.apiKey, 'OpenAI');
    case 'anthropic':
      return makeAnthropic(cfg.model, cfg.apiKey);
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`Unknown judgment provider: ${String(_exhaustive)}`);
    }
  }
}
