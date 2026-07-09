import { describe, it, expect } from 'bun:test';
import {
  consultChatGPT,
  DEFAULT_CONSULT_CHATGPT_MODEL,
  OPENAI_KEY_NAME,
  type ConsultChatGPTResult,
} from '../consult-openai.js';

describe('consultChatGPT', () => {
  it('happy path: resolves with model, response, and cost', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello from gpt-5' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test prompt' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.response).toBe('hello from gpt-5');
    expect(result.model).toBe(DEFAULT_CONSULT_CHATGPT_MODEL);
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(typeof result.usage.costUsd).toBe('number');
  });

  it('model override is honoured and echoed back', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test', model: 'gpt-4' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.model).toBe('gpt-4');
  });

  it('unknown model returns null costUsd (not fabricated)', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test', model: 'gpt-unknown' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.usage.costUsd).toBeNull();
  });

  it('missing prompt throws error', async () => {
    const mockGetSecret = () => 'sk-TEST-KEY';

    try {
      await consultChatGPT(
        { prompt: '' },
        { getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      expect(String(e)).toMatch(/Missing required: prompt/);
    }
  });

  it('missing key throws actionable error without fetch call', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 500 });
    }) as any;

    const mockGetSecret = () => undefined;

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain('OPENAI_API_KEY');
      expect(msg).toContain('Settings');
      expect(msg).toContain('Secrets');
      expect(fetchCalled).toBe(false);
    }
  });

  it('empty completion rejects with error (not degraded to verdict)', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      expect(String(e)).toMatch(/empty completion/i);
    }
  });

  it('API error response is parsed and thrown with detail', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Invalid API key provided' },
        }),
        { status: 401, statusText: 'Unauthorized' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain('OpenAI API error');
      expect(msg).toContain('401');
      expect(msg).toContain('Invalid API key provided');
    }
  });

  it('429 response retries and succeeds on attempt 2', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'Rate limit exceeded' },
          }),
          { status: 429, statusText: 'Too Many Requests' },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'success after retry' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.response).toBe('success after retry');
    expect(callCount).toBe(2);
  });

  it('5xx response retries and succeeds on attempt 2', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'Internal server error' },
          }),
          { status: 500, statusText: 'Internal Server Error' },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'success after retry' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.response).toBe('success after retry');
    expect(callCount).toBe(2);
  });

  it('429 response fails immediately on both attempts', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          error: { message: 'Rate limit exceeded' },
        }),
        { status: 429, statusText: 'Too Many Requests' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain('OpenAI API request failed (network)');
      expect(callCount).toBe(2);
    }
  });

  it('transient fetch error retries once then throws', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      throw new TypeError('socket connection was closed unexpectedly');
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain('OpenAI API request failed (network)');
      expect(callCount).toBe(2);
    }
  });

  it('transient failure on attempt 1, success on attempt 2 resolves', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('socket connection was closed unexpectedly');
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'success after retry' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.response).toBe('success after retry');
    expect(callCount).toBe(2);
  });

  it('API key never leaks in error message', async () => {
    const testKey = 'sk-TEST-SECRET-12345';
    const mockFetch = (async () => {
      throw new Error(`boom sk-TEST-SECRET-12345`);
    }) as any;

    const mockGetSecret = () => testKey;

    try {
      await consultChatGPT(
        { prompt: 'test' },
        { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
      );
      throw new Error('Should have thrown');
    } catch (e) {
      const msg = String(e);
      expect(msg).not.toContain(testKey);
      expect(msg).toContain('[redacted]');
    }
  });

  it('API key never in successful result JSON', async () => {
    const testKey = 'sk-TEST-SECRET';
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => testKey;

    const result = await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain(testKey);
  });

  it('system prompt is included in messages when provided', async () => {
    let capturedBody: string | null = null;

    const mockFetch = (async (url: string, options: any) => {
      capturedBody = options.body;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    await consultChatGPT(
      { prompt: 'user prompt', system: 'system context' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    const body = JSON.parse(capturedBody!);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system context' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'user prompt' });
  });

  it('Authorization header uses Bearer token', async () => {
    let capturedHeaders: Record<string, string> | null = null;

    const mockFetch = (async (url: string, options: any) => {
      capturedHeaders = options.headers;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(capturedHeaders!['Authorization']).toBe('Bearer sk-TEST-KEY');
  });

  it('POST to correct URL', async () => {
    let capturedUrl = '';

    const mockFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('DOMException AbortError triggers retry', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        const err = new DOMException('The operation was aborted', 'AbortError');
        throw err;
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'success' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    expect(result.response).toBe('success');
    expect(callCount).toBe(2);
  });

  it('cached tokens reduce input cost', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'response' } }],
          usage: {
            prompt_tokens: 100,
            prompt_tokens_details: { cached_tokens: 50 },
            completion_tokens: 10,
            total_tokens: 110,
          },
        }),
        { status: 200, statusText: 'OK' },
      )) as any;

    const mockGetSecret = () => 'sk-TEST-KEY';

    const result = await consultChatGPT(
      { prompt: 'test', model: 'gpt-5' },
      { fetchImpl: mockFetch, getSecretImpl: mockGetSecret },
    );

    const expectedCost = (50 * 1.25 + 50 * 0.125 + 10 * 10) / 1_000_000;
    expect(result.usage.costUsd).toBeCloseTo(expectedCost, 8);
  });
});
