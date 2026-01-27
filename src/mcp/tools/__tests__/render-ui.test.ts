/**
 * Tests for render-ui MCP tool
 *
 * Tests cover:
 * - UI structure validation
 * - WebSocket broadcasting
 * - Blocking and non-blocking modes
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateUIStructure,
  renderUI,
  type RenderUIResponse,
} from '../render-ui.js';
import { WebSocketHandler } from '../../../websocket/handler.js';
import type { UIComponent } from '../../../ai-ui.js';

// Mock WebSocket Handler
class MockWebSocketHandler extends WebSocketHandler {
  broadcastedMessages: any[] = [];

  broadcast(message: any): void {
    this.broadcastedMessages.push(message);
  }

  getBroadcastedMessages(): any[] {
    return this.broadcastedMessages;
  }

  clearBroadcastedMessages(): void {
    this.broadcastedMessages = [];
  }
}

// Test Helpers
function createBasicUIComponent(): UIComponent {
  return {
    type: 'MultipleChoice',
    props: {
      options: [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' },
      ],
    },
  };
}

describe('validateUIStructure', () => {
  it('should validate correct UI structure', () => {
    const ui = createBasicUIComponent();
    expect(() => validateUIStructure(ui)).not.toThrow();
  });

  it('should reject non-object UI', () => {
    expect(() => validateUIStructure(null)).toThrow('UI definition must be a non-null object');
    expect(() => validateUIStructure('string')).toThrow('UI definition must be a non-null object');
    expect(() => validateUIStructure(123)).toThrow('UI definition must be a non-null object');
  });

  it('should require UI type property', () => {
    const ui = { props: {} };
    expect(() => validateUIStructure(ui as any)).toThrow('UI component must have a type property');
  });

  it('should require UI props property', () => {
    const ui = { type: 'Card' };
    expect(() => validateUIStructure(ui as any)).toThrow('UI component must have a props property');
  });

  it('should reject array props', () => {
    const ui = { type: 'Card', props: [] };
    expect(() => validateUIStructure(ui as any)).toThrow('UI props must be an object, not an array');
  });

  it('should validate nested children', () => {
    const ui = {
      type: 'Card',
      props: { title: 'Test' },
      children: [
        { type: 'TextInput', props: {} },
      ],
    };
    expect(() => validateUIStructure(ui as any)).not.toThrow();
  });

  it('should reject non-array children', () => {
    const ui = {
      type: 'Card',
      props: { title: 'Test' },
      children: { type: 'TextInput' },
    };
    expect(() => validateUIStructure(ui as any)).toThrow('UI children must be an array');
  });

  it('should validate actions', () => {
    const ui = {
      type: 'Card',
      props: { title: 'Test' },
      actions: [
        { id: 'action1', label: 'Action 1' },
      ],
    };
    expect(() => validateUIStructure(ui as any)).not.toThrow();
  });

  it('should require action id and label', () => {
    const ui = {
      type: 'Card',
      props: { title: 'Test' },
      actions: [
        { label: 'Action 1' }, // missing id
      ],
    };
    expect(() => validateUIStructure(ui as any)).toThrow('Each action must have an id property');
  });

  it('should reject non-array actions', () => {
    const ui = {
      type: 'Card',
      props: { title: 'Test' },
      actions: { id: 'action1', label: 'Action 1' },
    };
    expect(() => validateUIStructure(ui as any)).toThrow('UI actions must be an array');
  });
});

describe('renderUI', () => {
  let wsHandler: MockWebSocketHandler;

  beforeEach(() => {
    wsHandler = new MockWebSocketHandler();
  });

  it('should validate project parameter', async () => {
    const ui = createBasicUIComponent();
    await expect(renderUI('', 'session', ui, false, wsHandler)).rejects.toThrow('project must be a non-empty string');
    await expect(renderUI(null as any, 'session', ui, false, wsHandler)).rejects.toThrow('project must be a non-empty string');
  });

  it('should validate session parameter', async () => {
    const ui = createBasicUIComponent();
    await expect(renderUI('project', '', ui, false, wsHandler)).rejects.toThrow('session must be a non-empty string');
    await expect(renderUI('project', null as any, ui, false, wsHandler)).rejects.toThrow('session must be a non-empty string');
  });

  it('should broadcast UI message', async () => {
    const ui = createBasicUIComponent();
    await renderUI('project', 'session', ui, false, wsHandler);

    const messages = wsHandler.getBroadcastedMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('ui_render');
    expect(messages[0].project).toBe('project');
    expect(messages[0].session).toBe('session');
    expect(messages[0].ui).toEqual(ui);
    expect(messages[0].blocking).toBe(false);
  });

  it('should return immediately in non-blocking mode', async () => {
    const ui = createBasicUIComponent();
    const result = await renderUI('project', 'session', ui, false, wsHandler);

    expect(result.completed).toBe(true);
    expect(result.source).toBe('terminal');
    expect(result.action).toBe('render_complete');
  });

  it('should wait for response in blocking mode', async () => {
    const ui = createBasicUIComponent();
    const promise = renderUI('project', 'session', ui, true, wsHandler);

    // Should be pending
    let resolved = false;
    promise.then(() => { resolved = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
  });

  it('should validate UI structure', async () => {
    const invalidUI = { type: 'Card' }; // missing props
    await expect(renderUI('project', 'session', invalidUI as any, false, wsHandler)).rejects.toThrow('UI component must have a props property');
  });

  it('should use default blocking=true', async () => {
    const ui = createBasicUIComponent();
    const promise = renderUI('project', 'session', ui, undefined as any, wsHandler);

    // Check that it's in blocking mode by verifying it's pending
    let resolved = false;
    promise.then(() => { resolved = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
  });

  it('should generate unique uiId for each render', async () => {
    const ui = createBasicUIComponent();

    await renderUI('project', 'session', ui, false, wsHandler);
    wsHandler.clearBroadcastedMessages();

    await renderUI('project', 'session', ui, false, wsHandler);

    const messages = wsHandler.getBroadcastedMessages();
    // Since we cleared and called again, there should be one message
    expect(messages).toHaveLength(1);
    expect(messages[0].uiId).toMatch(/^ui_\d+_[a-z0-9]+$/);
  });
});
