/**
 * MCP Tool: request_user_input
 *
 * Ask the user a question mid-turn via the UserInputBridge and wait for the
 * response. Emits a `user_input_requested` event on the session's EventLog so
 * the UI can render the prompt; on resolve/timeout emits a
 * `user_input_resolved` event.
 *
 * The tool returns the resolved `UserInputValue` as JSON. On timeout the tool
 * returns `{ kind: 'timeout' }` with `isError: true`.
 *
 * Dependencies are injected via a `RequestUserInputDeps` object so this
 * handler can be unit-tested without a live registry.
 */

import type {
  UserInputKind,
  UserInputValue,
  UserInputRequestedEvent,
  UserInputResolvedEvent,
} from '../../agent/contracts.js';
import type { UserInputBridge, UserInputChoice } from '../../agent/user-input-bridge.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface RequestUserInputArgs {
  sessionId: string;
  prompt: string;
  expectedKind: UserInputKind;
  choices?: Array<UserInputChoice>;
  timeoutMs?: number;
}

export interface RequestUserInputEventSink {
  emit(event: UserInputRequestedEvent | UserInputResolvedEvent): void;
}

export interface RequestUserInputDeps {
  bridge: UserInputBridge;
  eventSink: RequestUserInputEventSink;
}

export interface RequestUserInputResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function requestUserInput(
  deps: RequestUserInputDeps,
  args: RequestUserInputArgs,
): Promise<RequestUserInputResult> {
  const {
    sessionId,
    prompt,
    expectedKind,
    choices,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = args;

  if (!sessionId || !prompt || !expectedKind) {
    throw new Error('Missing required: sessionId, prompt, expectedKind');
  }
  if (expectedKind !== 'text' && expectedKind !== 'choice') {
    throw new Error(`Invalid expectedKind: ${expectedKind}`);
  }
  if (expectedKind === 'choice' && (!choices || choices.length === 0)) {
    throw new Error('choices is required when expectedKind is "choice"');
  }

  const { promptId, promise } = deps.bridge.request(
    sessionId,
    prompt,
    expectedKind,
    choices,
    timeoutMs,
  );

  const now = Date.now();
  const deadlineMs = now + timeoutMs;

  const requestedEvent: UserInputRequestedEvent = {
    kind: 'user_input_requested',
    sessionId,
    ts: now,
    promptId,
    prompt,
    expectedKind,
    ...(choices ? { choices } : {}),
    deadlineMs,
  };
  deps.eventSink.emit(requestedEvent);

  try {
    const value: UserInputValue = await promise;
    // NOTE: The `user_input_resolved` event is emitted by the dispatcher when
    // the UI's `agent_user_input_respond` command is handled. Emitting it here
    // would duplicate the event in the log (see review C2).
    return {
      content: [{ type: 'text', text: JSON.stringify(value) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'user_input_timeout') {
      const timeoutValue = { kind: 'timeout' as const };
      // Timeout path: the bridge rejects without a dispatcher command, so the
      // dispatcher will never emit. Emit the resolved event here so the UI
      // clears the pending prompt.
      const resolvedEvent: UserInputResolvedEvent = {
        kind: 'user_input_resolved',
        sessionId,
        ts: Date.now(),
        promptId,
        value: timeoutValue,
      };
      deps.eventSink.emit(resolvedEvent);
      return {
        content: [{ type: 'text', text: JSON.stringify(timeoutValue) }],
        isError: true,
      };
    }
    // Non-timeout errors (e.g. session_ended) propagate as an MCP error result.
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
      isError: true,
    };
  }
}

export const requestUserInputSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'The cmc session ID' },
    prompt: { type: 'string', description: 'The question to display to the user' },
    expectedKind: {
      type: 'string',
      enum: ['text', 'choice'],
      description: 'Input type',
    },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['id', 'label'],
      },
      description: 'Required when expectedKind is "choice"',
    },
    timeoutMs: {
      type: 'number',
      description: 'Override default timeout (default 10 minutes)',
    },
  },
  required: ['sessionId', 'prompt', 'expectedKind'],
} as const;
