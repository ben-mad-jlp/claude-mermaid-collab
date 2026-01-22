/**
 * Tests for render-ui MCP tool
 *
 * Tests cover:
 * - UI structure validation
 * - Timeout validation
 * - WebSocket broadcasting
 * - Blocking and non-blocking modes
 * - Error handling
 * - Response handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateUIStructure,
  validateTimeout,
  renderUI,
  handleUIResponse,
  createUIResponse,
  type RenderUIResponse,
} from '../render-ui.js';
import { WebSocketHandler } from '../../../websocket/handler.js';
import type { UIComponent } from '../../../ai-ui.js';

// ============================================================================
// MOCK WEBSOCKET HANDLER
// ============================================================================

class MockWebSocketHandler extends WebSocketHandler {
  broadcastedMessages: any[] = [];

  broadcast(message: any): void {
    this.broadcastedMessages.push({ type: 'broadcast', message });
    super.broadcast(message);
  }

  getBroadcastedMessages(): any[] {
    return this.broadcastedMessages;
  }

  clearBroadcastedMessages(): void {
    this.broadcastedMessages = [];
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createBasicUIComponent(): UIComponent {
  return {
    type: 'MultipleChoice',
    props: {
      options: [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' },
      ],
    },
    actions: [
      { id: 'submit', label: 'Submit', primary: true },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

function createComplexUIComponent(): UIComponent {
  return {
    type: 'Card',
    props: {
      title: 'Form Card',
      description: 'A complex form',
    },
    children: [
      {
        type: 'TextInput',
        props: {
          placeholder: 'Enter text',
          validation: { required: true },
        },
      },
      {
        type: 'MultipleChoice',
        props: {
          options: [
            { value: 'a', label: 'Choice A' },
            { value: 'b', label: 'Choice B' },
          ],
        },
      },
    ],
    actions: [
      { id: 'save', label: 'Save', primary: true },
      { id: 'reset', label: 'Reset' },
    ],
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('validateUIStructure', () => {
  it('should accept valid UI component with minimum properties', () => {
    const ui = {
      type: 'Button',
      props: {},
    };
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should accept valid UI component with actions', () => {
    const ui = createBasicUIComponent();
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should accept valid UI component with children', () => {
    const ui = createComplexUIComponent();
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should reject null or undefined UI', () => {
    expect(() => validateUIStructure(null)).toThrow('must be a non-null object');
    expect(() => validateUIStructure(undefined)).toThrow('must be a non-null object');
  });

  it('should reject non-object UI', () => {
    expect(() => validateUIStructure('not an object')).toThrow();
    expect(() => validateUIStructure(42)).toThrow();
    // Arrays are objects in JS but should be caught
    expect(() => validateUIStructure([])).toThrow();
  });

  it('should reject UI without type property', () => {
    const ui = { props: {} };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a type property');
  });

  it('should reject UI with empty type property', () => {
    const ui = { type: '', props: {} };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a type property');
  });

  it('should reject UI with non-string type property', () => {
    const ui = { type: 123, props: {} };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a type property');
  });

  it('should reject UI without props property', () => {
    const ui = { type: 'Button' };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a props property');
  });

  it('should reject UI with non-object props', () => {
    const ui = { type: 'Button', props: 'not an object' };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a props property');
  });

  it('should reject UI with array props', () => {
    const ui = { type: 'Button', props: [] };
    expect(() => validateUIStructure(ui as any)).toThrow('props must be an object, not an array');
  });

  it('should reject invalid children array', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: 'not an array',
    };
    expect(() => validateUIStructure(ui as any)).toThrow('children must be an array');
  });

  it('should reject invalid child component in children array', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: [
        {
          type: 'TextInput',
          props: {},
        },
        { type: 'Invalid' }, // Missing props
      ],
    };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a props property');
  });

  it('should reject non-array actions', () => {
    const ui = {
      type: 'Button',
      props: {},
      actions: { id: 'action1', label: 'Action' },
    };
    expect(() => validateUIStructure(ui as any)).toThrow('actions must be an array');
  });

  it('should reject action without id', () => {
    const ui = {
      type: 'Button',
      props: {},
      actions: [{ label: 'Action' }],
    };
    expect(() => validateUIStructure(ui as any)).toThrow('must have an id property');
  });

  it('should reject action without label', () => {
    const ui = {
      type: 'Button',
      props: {},
      actions: [{ id: 'action1' }],
    };
    expect(() => validateUIStructure(ui as any)).toThrow('must have a label property');
  });

  it('should reject action with non-string id', () => {
    const ui = {
      type: 'Button',
      props: {},
      actions: [{ id: 123, label: 'Action' }],
    };
    expect(() => validateUIStructure(ui as any)).toThrow('must have an id property');
  });

  it('should recursively validate nested children', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: [
        {
          type: 'Section',
          props: {},
          children: [
            {
              type: 'TextInput',
              props: {},
            },
          ],
        },
      ],
    };
    expect(() => validateUIStructure(ui as any)).not.toThrow();
  });
});

describe('validateTimeout', () => {
  it('should return default timeout when undefined', () => {
    const result = validateTimeout(undefined);
    expect(result).toBe(30000);
  });

  it('should accept valid timeout values', () => {
    expect(validateTimeout(1000)).toBe(1000);
    expect(validateTimeout(5000)).toBe(5000);
    expect(validateTimeout(30000)).toBe(30000);
    expect(validateTimeout(60000)).toBe(60000);
    expect(validateTimeout(300000)).toBe(300000);
  });

  it('should reject non-number timeout', () => {
    expect(() => validateTimeout('5000' as any)).toThrow('must be a finite number');
    expect(() => validateTimeout(null as any)).toThrow('must be a finite number');
    expect(() => validateTimeout({} as any)).toThrow('must be a finite number');
  });

  it('should reject non-finite numbers', () => {
    expect(() => validateTimeout(Infinity)).toThrow('must be a finite number');
    expect(() => validateTimeout(-Infinity)).toThrow('must be a finite number');
    expect(() => validateTimeout(NaN)).toThrow('must be a finite number');
  });

  it('should reject timeout below minimum', () => {
    expect(() => validateTimeout(999)).toThrow('must be at least 1000ms');
    expect(() => validateTimeout(0)).toThrow('must be at least 1000ms');
    expect(() => validateTimeout(-5000)).toThrow('must be at least 1000ms');
  });

  it('should reject timeout above maximum', () => {
    expect(() => validateTimeout(300001)).toThrow('must not exceed 300000ms');
    expect(() => validateTimeout(1000000)).toThrow('must not exceed 300000ms');
  });
});

describe('renderUI', () => {
  let wsHandler: MockWebSocketHandler;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  afterEach(() => {
    try {
      vi.useRealTimers();
    } catch {
      // Timers not active, ignore
    }
  });

  it('should validate project parameter', async () => {
    const ui = createBasicUIComponent();
    await expect(
      renderUI('', 'session', ui, false, undefined, wsHandler)
    ).rejects.toThrow('project must be a non-empty string');
  });

  it('should validate session parameter', async () => {
    const ui = createBasicUIComponent();
    await expect(
      renderUI('/project', '', ui, false, undefined, wsHandler)
    ).rejects.toThrow('session must be a non-empty string');
  });

  it('should validate UI structure', async () => {
    await expect(
      renderUI('/project', 'session', { type: 'Button' }, false, undefined, wsHandler)
    ).rejects.toThrow('must have a props property');
  });

  it('should broadcast UI message in non-blocking mode', async () => {
    const ui = createBasicUIComponent();
    const result = await renderUI('/project', 'session', ui, false, undefined, wsHandler);

    expect(result).toEqual({
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    });

    const messages = wsHandler.getBroadcastedMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].message.type).toBe('ui_render');
    expect(messages[0].message.project).toBe('/project');
    expect(messages[0].message.session).toBe('session');
  });

  it('should include UI ID in broadcast message', async () => {
    const ui = createBasicUIComponent();
    await renderUI('/project', 'session', ui, false, undefined, wsHandler);

    const messages = wsHandler.getBroadcastedMessages();
    const message = messages[0].message;
    expect(message.uiId).toBeDefined();
    expect(typeof message.uiId).toBe('string');
    expect(message.uiId).toMatch(/^ui_\d+_[a-z0-9]+$/);
  });

  it('should include blocking flag in broadcast message', async () => {
    const ui = createBasicUIComponent();
    await renderUI('/project', 'session', ui, false, undefined, wsHandler);

    const messages = wsHandler.getBroadcastedMessages();
    expect(messages[0].message.blocking).toBe(false);
  });

  it('should include timestamp in broadcast message', async () => {
    const ui = createBasicUIComponent();
    const beforeTime = Date.now();
    await renderUI('/project', 'session', ui, false, undefined, wsHandler);
    const afterTime = Date.now();

    const messages = wsHandler.getBroadcastedMessages();
    const timestamp = messages[0].message.timestamp;
    expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(timestamp).toBeLessThanOrEqual(afterTime);
  });

  it('should handle complex nested UI structures', async () => {
    const ui = createComplexUIComponent();
    const result = await renderUI('/project', 'session', ui, false, undefined, wsHandler);

    expect(result.completed).toBe(true);
    const messages = wsHandler.getBroadcastedMessages();
    expect(messages[0].message.ui).toEqual(ui);
  });

  it('should timeout in blocking mode if no response received', async () => {
    vi.useFakeTimers();
    const ui = createBasicUIComponent();

    const promise = renderUI('/project', 'session', ui, true, 5000, wsHandler);

    // Advance time past timeout
    vi.advanceTimersByTime(6000);

    await expect(promise).rejects.toThrow('UI interaction timeout after 5000ms');

    vi.useRealTimers();
  });

  it('should use default timeout when not specified in blocking mode', async () => {
    vi.useFakeTimers();
    const ui = createBasicUIComponent();

    const promise = renderUI('/project', 'session', ui, true, undefined, wsHandler);

    // Advance time past default timeout (30 seconds)
    vi.advanceTimersByTime(31000);

    await expect(promise).rejects.toThrow('UI interaction timeout after 30000ms');

    vi.useRealTimers();
  });

  it('should respect custom timeout in blocking mode', async () => {
    vi.useFakeTimers();
    const ui = createBasicUIComponent();

    const promise = renderUI('/project', 'session', ui, true, 10000, wsHandler);

    // Advance past timeout
    vi.advanceTimersByTime(11000);

    await expect(promise).rejects.toThrow('UI interaction timeout after 10000ms');

    vi.useRealTimers();
  });

  it('should validate timeout in blocking mode', async () => {
    const ui = createBasicUIComponent();

    await expect(
      renderUI('/project', 'session', ui, true, 999, wsHandler)
    ).rejects.toThrow('Timeout must be at least 1000ms');
  });
});

describe('handleUIResponse', () => {
  let wsHandler: MockWebSocketHandler;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  it('should ignore invalid response objects', () => {
    expect(() => handleUIResponse(wsHandler, null as any)).not.toThrow();
    expect(() => handleUIResponse(wsHandler, undefined as any)).not.toThrow();
    expect(() => handleUIResponse(wsHandler, 'not an object' as any)).not.toThrow();
  });

  it('should handle response without matching handler', () => {
    const response = createUIResponse('unknown_ui_id', 'action1');
    expect(() => handleUIResponse(wsHandler, response)).not.toThrow();
  });

  it('should call handler for matching UI ID', () => {
    const handler = vi.fn();
    (wsHandler as any).__pendingUIHandlers = {
      'test_ui_id': handler,
    };

    const response = createUIResponse('test_ui_id', 'action1', { key: 'value' });
    handleUIResponse(wsHandler, response);

    expect(handler).toHaveBeenCalledWith(response);
  });

  it('should delete handler after calling it', () => {
    const handler = vi.fn();
    (wsHandler as any).__pendingUIHandlers = {
      'test_ui_id': handler,
    };

    const response = createUIResponse('test_ui_id', 'action1');
    handleUIResponse(wsHandler, response);

    expect((wsHandler as any).__pendingUIHandlers['test_ui_id']).toBeUndefined();
  });

  it('should handle errors in handler gracefully', () => {
    const handler = vi.fn(() => {
      throw new Error('Handler error');
    });
    (wsHandler as any).__pendingUIHandlers = {
      'test_ui_id': handler,
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = createUIResponse('test_ui_id', 'action1');

    expect(() => handleUIResponse(wsHandler, response)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith('Error handling UI response:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});

describe('createUIResponse', () => {
  it('should create valid UI response with required fields', () => {
    const response = createUIResponse('ui_123', 'submit_action');

    expect(response.componentId).toBe('ui_123');
    expect(response.actionId).toBe('submit_action');
    expect(response.data).toEqual({});
    expect(typeof response.timestamp).toBe('number');
  });

  it('should include form data in response', () => {
    const data = { name: 'John', email: 'john@example.com' };
    const response = createUIResponse('ui_123', 'submit_action', data);

    expect(response.data).toEqual(data);
  });

  it('should generate timestamp', () => {
    const before = Date.now();
    const response = createUIResponse('ui_123', 'submit_action');
    const after = Date.now();

    expect(response.timestamp).toBeGreaterThanOrEqual(before);
    expect(response.timestamp).toBeLessThanOrEqual(after);
  });

  it('should handle complex data structures', () => {
    const complexData = {
      user: {
        name: 'John',
        profile: {
          age: 30,
          tags: ['developer', 'designer'],
        },
      },
      metadata: {
        version: 1,
        active: true,
      },
    };
    const response = createUIResponse('ui_123', 'submit_action', complexData);

    expect(response.data).toEqual(complexData);
  });
});

describe('Integration: renderUI with handleUIResponse', () => {
  let wsHandler: MockWebSocketHandler;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  afterEach(() => {
    try {
      vi.useRealTimers();
    } catch {
      // Timers not active, ignore
    }
  });

  it('should complete blocking render when response is handled', async () => {
    vi.useFakeTimers();

    const ui = createBasicUIComponent();
    const renderPromise = renderUI('/project', 'session', ui, true, 10000, wsHandler);

    // Get the UI ID from the broadcast message
    const messages = wsHandler.getBroadcastedMessages();
    const uiId = messages[0].message.uiId;

    // Simulate user action after 500ms
    setTimeout(() => {
      const response = createUIResponse(uiId, 'submit', { selected: 'option1' });
      handleUIResponse(wsHandler, response);
    }, 500);

    vi.advanceTimersByTime(600);
    const result = await renderPromise;

    expect(result.completed).toBe(true);
    expect(result.source).toBe('browser');
    expect(result.action).toBe('submit');
    expect(result.data).toEqual({ selected: 'option1' });

    vi.useRealTimers();
  });

  it('should still timeout if response is for wrong UI ID', async () => {
    vi.useFakeTimers();

    const ui = createBasicUIComponent();
    const renderPromise = renderUI('/project', 'session', ui, true, 5000, wsHandler);

    // Get the UI ID from the broadcast message
    const messages = wsHandler.getBroadcastedMessages();
    const correctUiId = messages[0].message.uiId;

    // Simulate response for wrong UI ID
    setTimeout(() => {
      const response = createUIResponse('wrong_ui_id', 'submit', { selected: 'option1' });
      handleUIResponse(wsHandler, response);
    }, 500);

    vi.advanceTimersByTime(6000);

    await expect(renderPromise).rejects.toThrow('UI interaction timeout after 5000ms');

    vi.useRealTimers();
  });
});
