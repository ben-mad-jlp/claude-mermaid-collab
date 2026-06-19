/**
 * Unit tests for src/services/judgment-llm.ts — the swappable daemon judgment LLM.
 *
 * Mocks global fetch to assert the per-provider request shape WITHOUT network:
 *  - xAI/OpenAI post to {base}/chat/completions (OpenAI-style body + Bearer auth)
 *  - Anthropic posts to api.anthropic.com/v1/messages with the version header.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { makeJudgmentLLM } from '../judgment-llm';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Captured { url: string; init: RequestInit }

function mockFetch(jsonBody: any): () => Captured {
  let captured: Captured | null = null;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url: String(url), init };
    return {
      ok: true,
      status: 200,
      json: async () => jsonBody,
    } as any;
  }) as any;
  return () => {
    if (!captured) throw new Error('fetch was not called');
    return captured;
  };
}

describe('makeJudgmentLLM — xAI path', () => {
  it('posts to api.x.ai chat/completions with OpenAI-style body + Bearer auth', async () => {
    const get = mockFetch({ choices: [{ message: { content: 'xai-reply' } }] });
    const llm = makeJudgmentLLM({ provider: 'xai', model: 'grok-build-0.1', apiKey: 'k1' });
    const out = await llm.complete('sys', 'usr');

    expect(out).toBe('xai-reply');
    const { url, init } = get();
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect((init.headers as any).Authorization).toBe('Bearer k1');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('grok-build-0.1');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });
});

describe('makeJudgmentLLM — OpenAI path', () => {
  it('posts to api.openai.com chat/completions', async () => {
    const get = mockFetch({ choices: [{ message: { content: 'oai' } }] });
    const llm = makeJudgmentLLM({ provider: 'openai', model: 'gpt-4o', apiKey: 'k2' });
    await llm.complete('s', 'u');
    expect(get().url).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('makeJudgmentLLM — Anthropic path', () => {
  it('posts to api.anthropic.com/v1/messages with x-api-key + anthropic-version header', async () => {
    const get = mockFetch({ content: [{ type: 'text', text: 'claude-' }, { type: 'text', text: 'reply' }] });
    const llm = makeJudgmentLLM({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'k3' });
    const out = await llm.complete('sys', 'usr');

    expect(out).toBe('claude-reply');
    const { url, init } = get();
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as any;
    expect(headers['x-api-key']).toBe('k3');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
  });
});

describe('makeJudgmentLLM — errors', () => {
  it('throws when the API key is missing', async () => {
    const llm = makeJudgmentLLM({ provider: 'xai', model: 'm', apiKey: '' });
    await expect(llm.complete('s', 'u')).rejects.toThrow();
  });

  it('throws on a non-ok response', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) } as any)) as any;
    const llm = makeJudgmentLLM({ provider: 'anthropic', model: 'm', apiKey: 'k' });
    await expect(llm.complete('s', 'u')).rejects.toThrow('Anthropic API error 500');
  });
});

describe('makeJudgmentLLM — claude (subscription) path', () => {
  it('routes to a JudgmentLLM with NO network/key dependency (spawns claude -p)', () => {
    // The subscription provider needs no apiKey + no fetch — it shells out to `claude -p`.
    // The real spawn is integration-only; here we just assert the factory routes it without
    // requiring a key or touching fetch (a thrown error would mean a routing/typo bug).
    const fetchSpy = (() => { throw new Error('fetch must not be called for the claude provider'); }) as any;
    globalThis.fetch = fetchSpy;
    const llm = makeJudgmentLLM({ provider: 'claude', model: 'sonnet', apiKey: '', cwd: '/tmp' });
    expect(typeof llm.complete).toBe('function');
  });
});
