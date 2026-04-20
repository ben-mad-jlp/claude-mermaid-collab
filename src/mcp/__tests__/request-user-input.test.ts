/**
 * Tests for the request_user_input MCP tool handler.
 *
 * We exercise the exported `requestUserInput(deps, args)` helper directly so
 * the tests don't need a live AgentSessionRegistry. The real bridge is used
 * (it's small and pure) and the event sink is a jest.fn-style spy.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  requestUserInput,
  requestUserInputSchema,
  type RequestUserInputEventSink,
} from '../tools/request-user-input.js';
import { UserInputBridge } from '../../agent/user-input-bridge.js';

function makeSink(): RequestUserInputEventSink & { events: any[]; emit: ReturnType<typeof vi.fn> } {
  const events: any[] = [];
  const emit = vi.fn((ev: any) => { events.push(ev); });
  return { events, emit };
}

describe('requestUserInput (MCP tool handler)', () => {
  it('emits user_input_requested then resolves when bridge.respond is called', async () => {
    const bridge = new UserInputBridge();
    const sink = makeSink();

    const promise = requestUserInput(
      { bridge, eventSink: sink },
      {
        sessionId: 's1',
        prompt: 'What is your name?',
        expectedKind: 'text',
      },
    );

    // The request event should be emitted synchronously before the promise
    // resolves. Grab the promptId from it and respond.
    // Allow microtask queue to drain.
    await Promise.resolve();

    expect(sink.events.length).toBe(1);
    const req = sink.events[0];
    expect(req.kind).toBe('user_input_requested');
    expect(req.sessionId).toBe('s1');
    expect(req.prompt).toBe('What is your name?');
    expect(req.expectedKind).toBe('text');
    expect(typeof req.promptId).toBe('string');
    expect(typeof req.deadlineMs).toBe('number');

    const ok = bridge.respond('s1', req.promptId, { kind: 'text', text: 'Alice' });
    expect(ok).toBe(true);

    const result = await promise;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ kind: 'text', text: 'Alice' });

    // The resolved event is NOT emitted here; the dispatcher owns the
    // `user_input_resolved` emission when it handles `agent_user_input_respond`
    // (see review C2). The sink should have seen only the request event.
    expect(sink.events.length).toBe(1);
  });

  it('returns timeout result when the bridge promise times out', async () => {
    const bridge = new UserInputBridge();
    const sink = makeSink();

    const result = await requestUserInput(
      { bridge, eventSink: sink },
      {
        sessionId: 's2',
        prompt: 'pick one',
        expectedKind: 'choice',
        choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        timeoutMs: 10,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({ kind: 'timeout' });

    // Both requested + resolved(timeout) should have been emitted.
    expect(sink.events.length).toBe(2);
    expect(sink.events[0].kind).toBe('user_input_requested');
    expect(sink.events[1].kind).toBe('user_input_resolved');
    expect(sink.events[1].value).toEqual({ kind: 'timeout' });
  });

  it('calls bridge.request with the expected arguments', async () => {
    const bridge = new UserInputBridge();
    const spy = vi.spyOn(bridge, 'request');
    const sink = makeSink();

    const promise = requestUserInput(
      { bridge, eventSink: sink },
      {
        sessionId: 's3',
        prompt: 'go?',
        expectedKind: 'choice',
        choices: [{ id: 'y', label: 'Yes' }],
        timeoutMs: 5000,
      },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    expect(call[0]).toBe('s3');
    expect(call[1]).toBe('go?');
    expect(call[2]).toBe('choice');
    expect(call[3]).toEqual([{ id: 'y', label: 'Yes' }]);
    expect(call[4]).toBe(5000);

    // resolve to let the promise settle
    const req = sink.events[0];
    bridge.respond('s3', req.promptId, { kind: 'choice', choiceId: 'y' });
    await promise;
  });

  it('rejects when expectedKind="choice" without choices', async () => {
    const bridge = new UserInputBridge();
    const sink = makeSink();

    await expect(
      requestUserInput(
        { bridge, eventSink: sink },
        {
          sessionId: 's4',
          prompt: 'pick',
          expectedKind: 'choice',
        },
      ),
    ).rejects.toThrow(/choices is required/);
  });
});

describe('requestUserInputSchema', () => {
  it('matches the documented shape', () => {
    expect(requestUserInputSchema.type).toBe('object');
    expect(requestUserInputSchema.required).toEqual(['sessionId', 'prompt', 'expectedKind']);
    expect(requestUserInputSchema.properties.expectedKind.enum).toEqual(['text', 'choice']);
    expect(requestUserInputSchema.properties.choices.type).toBe('array');
  });
});
