/**
 * Tests for render-ui MCP tool
 *
 * Verifies UI rendering, validation, and response handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderUI,
  renderUISchema,
  validateUIStructure,
  handleUIResponse,
  createUIResponse,
  type RenderUIResponse,
} from './render-ui';
import { WebSocketHandler } from '../../websocket/handler.js';
import type { UIResponse } from '../../ai-ui.js';

// Mock WebSocketHandler
class MockWebSocketHandler {
  broadcastedMessages: any[] = [];

  broadcast(message: any) {
    this.broadcastedMessages.push(message);
  }

  __pendingUIHandlers: Record<string, Function> = {};
}

describe('validateUIStructure', () => {
  it('should accept valid UI component', () => {
    const ui = {
      type: 'Card',
      props: {
        title: 'Test Card',
      },
    };
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should reject null UI', () => {
    expect(() => validateUIStructure(null)).toThrow('non-null object');
  });

  it('should reject non-object UI', () => {
    expect(() => validateUIStructure('not an object')).toThrow(
      'non-null object'
    );
  });

  it('should reject UI without type', () => {
    const ui = {
      props: {},
    };
    expect(() => validateUIStructure(ui)).toThrow('type property');
  });

  it('should reject UI with non-string type', () => {
    const ui = {
      type: 123,
      props: {},
    };
    expect(() => validateUIStructure(ui)).toThrow('type property');
  });

  it('should reject UI without props', () => {
    const ui = {
      type: 'Card',
    };
    expect(() => validateUIStructure(ui)).toThrow('props property');
  });

  it('should reject UI with array props', () => {
    const ui = {
      type: 'Card',
      props: [],
    };
    expect(() => validateUIStructure(ui)).toThrow('props must be an object');
  });

  it('should validate nested children', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: [
        {
          type: 'Spinner',
          props: {},
        },
      ],
    };
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should reject invalid children', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: [
        {
          type: 'Spinner',
          // missing props
        },
      ],
    };
    expect(() => validateUIStructure(ui)).toThrow('props property');
  });

  it('should reject non-array children', () => {
    const ui = {
      type: 'Card',
      props: {},
      children: { type: 'Spinner', props: {} },
    };
    expect(() => validateUIStructure(ui)).toThrow('children must be an array');
  });

  it('should validate actions', () => {
    const ui = {
      type: 'Confirmation',
      props: {},
      actions: [
        { id: 'confirm', label: 'Confirm' },
        { id: 'cancel', label: 'Cancel' },
      ],
    };
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should reject invalid actions', () => {
    const ui = {
      type: 'Confirmation',
      props: {},
      actions: [{ id: 'confirm' }], // missing label
    };
    expect(() => validateUIStructure(ui)).toThrow('label property');
  });

  it('should reject non-array actions', () => {
    const ui = {
      type: 'Confirmation',
      props: {},
      actions: { id: 'confirm', label: 'Confirm' },
    };
    expect(() => validateUIStructure(ui)).toThrow('actions must be an array');
  });
});

describe('renderUISchema', () => {
  it('should have required properties', () => {
    expect(renderUISchema.required).toContain('project');
    expect(renderUISchema.required).toContain('session');
    expect(renderUISchema.required).toContain('ui');
  });

  it('should NOT have timeout property', () => {
    expect(renderUISchema.properties).not.toHaveProperty('timeout');
  });

  it('should have project property', () => {
    expect(renderUISchema.properties.project).toBeDefined();
    expect(renderUISchema.properties.project.type).toBe('string');
  });

  it('should have session property', () => {
    expect(renderUISchema.properties.session).toBeDefined();
    expect(renderUISchema.properties.session.type).toBe('string');
  });

  it('should have ui property', () => {
    expect(renderUISchema.properties.ui).toBeDefined();
    expect(renderUISchema.properties.ui.type).toBe('object');
  });

  it('should have blocking property with default true', () => {
    expect(renderUISchema.properties.blocking).toBeDefined();
    expect(renderUISchema.properties.blocking.type).toBe('boolean');
    expect(renderUISchema.properties.blocking.default).toBe(true);
  });
});

describe('renderUI', () => {
  let wsHandler: any;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  it('should validate project parameter', async () => {
    const ui = { type: 'Card', props: {} };
    await expect(
      renderUI('', 'test-session', ui, false, wsHandler)
    ).rejects.toThrow('project must be a non-empty string');
  });

  it('should validate session parameter', async () => {
    const ui = { type: 'Card', props: {} };
    await expect(
      renderUI('/test/path', '', ui, false, wsHandler)
    ).rejects.toThrow('session must be a non-empty string');
  });

  it('should validate UI structure', async () => {
    const invalidUI = { type: 'Card' }; // missing props
    await expect(
      renderUI('/test/path', 'test-session', invalidUI, false, wsHandler)
    ).rejects.toThrow('props property');
  });

  it('should return immediately when not blocking', async () => {
    const ui = { type: 'Card', props: {} };
    const result = await renderUI(
      '/test/path',
      'test-session',
      ui,
      false,
      wsHandler
    );

    expect(result).toEqual({
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    });
  });

  it('should broadcast UI message when blocking', async () => {
    const ui = { type: 'Card', props: { title: 'Test' } };

    const promise = renderUI('/test/path', 'test-session', ui, true, wsHandler);

    // Give promise time to register handler
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(wsHandler.broadcastedMessages).toHaveLength(1);
    const message = wsHandler.broadcastedMessages[0];
    expect(message.type).toBe('ui_render');
    expect(message.project).toBe('/test/path');
    expect(message.session).toBe('test-session');
    expect(message.blocking).toBe(true);
    expect(message.ui).toEqual(ui);
    expect(message.uiId).toBeDefined();

    // Cleanup the pending promise
    promise.catch(() => {}); // suppress unhandled rejection
  });

  it('should register UI response handler when blocking', async () => {
    const ui = { type: 'Card', props: {} };

    const promise = renderUI('/test/path', 'test-session', ui, true, wsHandler);

    // Give promise time to register handler
    await new Promise(resolve => setTimeout(resolve, 10));

    // Extract the UI ID from the broadcasted message
    const uiId = wsHandler.broadcastedMessages[0].uiId;
    expect(wsHandler.__pendingUIHandlers[uiId]).toBeDefined();

    // Cleanup
    promise.catch(() => {});
  });

  it('should resolve with UI response when handler called', async () => {
    const ui = { type: 'Card', props: {} };

    const promise = renderUI('/test/path', 'test-session', ui, true, wsHandler);

    // Give promise time to register handler
    await new Promise(resolve => setTimeout(resolve, 10));

    // Get the UI ID and handler
    const uiId = wsHandler.broadcastedMessages[0].uiId;
    const handler = wsHandler.__pendingUIHandlers[uiId];

    // Simulate user response
    const uiResponse: UIResponse = {
      componentId: uiId,
      actionId: 'confirm',
      data: { name: 'test' },
      timestamp: Date.now(),
    };
    handler(uiResponse);

    const result = await promise;
    expect(result).toEqual({
      completed: true,
      source: 'browser',
      action: 'confirm',
      data: { name: 'test' },
    });
  });

  it('should ignore responses for different UI IDs', async () => {
    const ui = { type: 'Card', props: {} };

    const promise = renderUI('/test/path', 'test-session', ui, true, wsHandler);

    // Give promise time to register handler
    await new Promise(resolve => setTimeout(resolve, 10));

    // Get the UI ID
    const uiId = wsHandler.broadcastedMessages[0].uiId;

    // Send response with different UI ID
    const uiResponse: UIResponse = {
      componentId: 'different-id',
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };
    handleUIResponse(wsHandler, uiResponse);

    // Promise should still be pending
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(false);

    // Now send correct response
    const correctResponse: UIResponse = {
      componentId: uiId,
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };
    handleUIResponse(wsHandler, correctResponse);

    const result = await promise;
    expect(result.completed).toBe(true);
  });
});

describe('handleUIResponse', () => {
  let wsHandler: any;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  it('should handle valid response', () => {
    const uiId = 'test-ui-123';
    let callbackCalled = false;

    wsHandler.__pendingUIHandlers[uiId] = (response: UIResponse) => {
      callbackCalled = true;
      expect(response.actionId).toBe('confirm');
    };

    const response: UIResponse = {
      componentId: uiId,
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };

    handleUIResponse(wsHandler, response);
    expect(callbackCalled).toBe(true);
  });

  it('should clean up handler after response', () => {
    const uiId = 'test-ui-123';
    wsHandler.__pendingUIHandlers[uiId] = () => {};

    const response: UIResponse = {
      componentId: uiId,
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };

    handleUIResponse(wsHandler, response);
    expect(wsHandler.__pendingUIHandlers[uiId]).toBeUndefined();
  });

  it('should ignore response for non-existent handler', () => {
    const response: UIResponse = {
      componentId: 'non-existent',
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };

    expect(() => handleUIResponse(wsHandler, response)).not.toThrow();
  });

  it('should ignore invalid response', () => {
    expect(() => handleUIResponse(wsHandler, null as any)).not.toThrow();
    expect(() => handleUIResponse(wsHandler, undefined as any)).not.toThrow();
  });

  it('should handle handler errors gracefully', () => {
    const uiId = 'test-ui-123';
    wsHandler.__pendingUIHandlers[uiId] = () => {
      throw new Error('Handler error');
    };

    const response: UIResponse = {
      componentId: uiId,
      actionId: 'confirm',
      data: {},
      timestamp: Date.now(),
    };

    expect(() => handleUIResponse(wsHandler, response)).not.toThrow();
  });
});

describe('createUIResponse', () => {
  it('should create response with required fields', () => {
    const response = createUIResponse('ui-123', 'confirm');
    expect(response.componentId).toBe('ui-123');
    expect(response.actionId).toBe('confirm');
    expect(response.data).toEqual({});
    expect(response.timestamp).toBeDefined();
  });

  it('should include provided data', () => {
    const data = { name: 'test', value: 42 };
    const response = createUIResponse('ui-123', 'confirm', data);
    expect(response.data).toEqual(data);
  });
});

describe('timeout removal verification', () => {
  it('renderUI should accept 5 parameters (no timeout)', async () => {
    const wsHandler = new MockWebSocketHandler();
    const ui = { type: 'Card', props: {} };

    // This should not throw - function signature should be:
    // renderUI(project, session, ui, blocking, wsHandler)
    const promise = renderUI(
      '/test/path',
      'test-session',
      ui,
      false,
      wsHandler
    );

    const result = await promise;
    expect(result.completed).toBe(true);
  });

  it('schema should not have timeout property', () => {
    // Verify that renderUISchema does not include timeout property
    expect(renderUISchema.properties).not.toHaveProperty('timeout');
  });

  it('should not accept timeout parameter in renderUI', async () => {
    const wsHandler = new MockWebSocketHandler();
    const ui = { type: 'Card', props: {} };

    // TypeScript should error if we try to pass 6 parameters with timeout
    // For runtime verification, we ensure the function works with 5 params
    const promise = renderUI(
      '/test/path',
      'test-session',
      ui,
      false,
      wsHandler
    );

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.source).toBe('terminal');
  });
});
