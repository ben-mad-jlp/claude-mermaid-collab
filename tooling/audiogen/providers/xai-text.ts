import { getSecret } from '../../../src/services/config-service.ts';

/**
 * Grok TEXT helper — used to turn a plain-language brief into STRUCTURED params
 * (sfxr SFX params, chiptune music patterns). The "Grok decides, our code renders"
 * pattern for audio. OpenAI-compatible chat/completions on xAI.
 */
const ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.20-0309-non-reasoning';

/** Ask Grok for a JSON object. Returns the parsed object. `system` describes the schema. */
export async function completeJson<T = any>(system: string, user: string, opts: { model?: string } = {}): Promise<T> {
  const apiKey = getSecret('XAI_API_KEY') ?? process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set (checked config.json via getSecret and env).');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`xAI chat failed: ${res.status} ${res.statusText} ${t}`.trim());
  }
  const json = await res.json() as any;
  let content: string = json?.choices?.[0]?.message?.content ?? '';
  content = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(content) as T; }
  catch { const m = content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]) as T; throw new Error('xAI did not return parseable JSON'); }
}
