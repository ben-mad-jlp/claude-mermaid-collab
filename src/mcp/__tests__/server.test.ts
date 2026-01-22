/**
 * Integration tests for the MCP server
 *
 * Tests cover:
 * - render_ui tool registration and execution
 * - update_ui tool registration and execution
 * - dismiss_ui tool registration and execution
 * - Tool schemas validation
 * - Error handling across all tools
 * - Integration with MCP server handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We'll test the individual tools and their schemas since full server testing
// requires stdio transport setup which is complex in testing environment

// Import the tool functions and schemas
import { renderUI, renderUISchema, validateUIStructure, validateTimeout } from '../tools/render-ui.js';
import { updateUI, updateUISchema } from '../tools/update-ui.js';
import { dismissUI, dismissUISchema } from '../tools/dismiss-ui.js';
import { WebSocketHandler } from '../../websocket/handler.js';
import type { UIComponent } from '../../ai-ui.js';

// Mock fetch globally
global.fetch = vi.fn();

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

// ============================================================================
// TOOL SCHEMA TESTS
// ============================================================================

describe('MCP Tool Schemas', () => {
  describe('renderUISchema', () => {
    it('should define correct schema structure', () => {
      expect(renderUISchema).toEqual({
        type: 'object',
        properties: expect.objectContaining({
          project: expect.any(Object),
          session: expect.any(Object),
          ui: expect.any(Object),
          blocking: expect.any(Object),
          timeout: expect.any(Object),
        }),
        required: expect.any(Array),
      });
    });

    it('should require project, session, and ui fields', () => {
      expect(renderUISchema.required).toContain('project');
      expect(renderUISchema.required).toContain('session');
      expect(renderUISchema.required).toContain('ui');
    });

    it('should not require blocking and timeout fields', () => {
      expect(renderUISchema.required).not.toContain('blocking');
      expect(renderUISchema.required).not.toContain('timeout');
    });

    it('should have proper property descriptions', () => {
      expect(renderUISchema.properties.project.description).toContain('project root directory');
      expect(renderUISchema.properties.session.description).toContain('Session name');
      expect(renderUISchema.properties.ui.description).toContain('UI component');
      expect(renderUISchema.properties.blocking.description).toContain('user action');
      expect(renderUISchema.properties.timeout.description).toContain('milliseconds');
    });

    it('should have correct default values', () => {
      expect(renderUISchema.properties.blocking.default).toBe(true);
      expect(renderUISchema.properties.timeout.default).toBe(30000);
    });
  });

  describe('updateUISchema', () => {
    it('should define correct schema structure', () => {
      expect(updateUISchema).toEqual({
        type: 'object',
        properties: expect.objectContaining({
          project: expect.any(Object),
          session: expect.any(Object),
          patch: expect.any(Object),
        }),
        required: expect.any(Array),
      });
    });

    it('should require project, session, and patch fields', () => {
      expect(updateUISchema.required).toContain('project');
      expect(updateUISchema.required).toContain('session');
      expect(updateUISchema.required).toContain('patch');
      expect(updateUISchema.required.length).toBe(3);
    });

    it('should define patch as object with additional properties', () => {
      expect(updateUISchema.properties.patch.type).toBe('object');
      expect(updateUISchema.properties.patch.additionalProperties).toBe(true);
    });
  });

  describe('dismissUISchema', () => {
    it('should define correct schema structure', () => {
      expect(dismissUISchema).toEqual({
        type: 'object',
        properties: expect.objectContaining({
          project: expect.any(Object),
          session: expect.any(Object),
        }),
        required: expect.any(Array),
      });
    });

    it('should require project and session fields', () => {
      expect(dismissUISchema.required).toContain('project');
      expect(dismissUISchema.required).toContain('session');
      expect(dismissUISchema.required.length).toBe(2);
    });
  });
});

// ============================================================================
// RENDER_UI TOOL INTEGRATION TESTS
// ============================================================================

describe('render_ui Tool Integration', () => {
  let wsHandler: WebSocketHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    wsHandler = new WebSocketHandler();
  });

  it('should execute renderUI with valid parameters', async () => {
    const ui = createBasicUIComponent();
    const result = await renderUI(
      '/test/project',
      'test-session',
      ui,
      false,
      undefined,
      wsHandler
    );

    expect(result).toBeDefined();
    expect(result.completed).toBe(true);
    expect(result.source).toBe('terminal');
  });

  it('should validate UI structure before rendering', async () => {
    const invalidUI = { type: 'Button' }; // Missing props

    await expect(
      renderUI('/test/project', 'test-session', invalidUI, false, undefined, wsHandler)
    ).rejects.toThrow('must have a props property');
  });

  it('should validate project parameter', async () => {
    const ui = createBasicUIComponent();

    await expect(
      renderUI('', 'test-session', ui, false, undefined, wsHandler)
    ).rejects.toThrow('project must be a non-empty string');
  });

  it('should validate session parameter', async () => {
    const ui = createBasicUIComponent();

    await expect(
      renderUI('/test/project', '', ui, false, undefined, wsHandler)
    ).rejects.toThrow('session must be a non-empty string');
  });

  it('should broadcast UI in non-blocking mode', async () => {
    const ui = createBasicUIComponent();
    const broadcastSpy = vi.spyOn(wsHandler, 'broadcast');

    await renderUI('/test/project', 'test-session', ui, false, undefined, wsHandler);

    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedMessage = broadcastSpy.mock.calls[0][0];
    expect(broadcastedMessage.type).toBe('ui_render');
    expect(broadcastedMessage.project).toBe('/test/project');
    expect(broadcastedMessage.session).toBe('test-session');
    expect(broadcastedMessage.ui).toEqual(ui);
    expect(broadcastedMessage.blocking).toBe(false);
  });

  it('should include UI ID and timestamp in broadcast', async () => {
    const ui = createBasicUIComponent();
    const broadcastSpy = vi.spyOn(wsHandler, 'broadcast');

    await renderUI('/test/project', 'test-session', ui, false, undefined, wsHandler);

    const broadcastedMessage = broadcastSpy.mock.calls[0][0];
    expect(broadcastedMessage.uiId).toBeDefined();
    expect(typeof broadcastedMessage.uiId).toBe('string');
    expect(broadcastedMessage.timestamp).toBeDefined();
    expect(typeof broadcastedMessage.timestamp).toBe('number');
  });

  it('should validate timeout when in blocking mode', async () => {
    const ui = createBasicUIComponent();

    await expect(
      renderUI('/test/project', 'test-session', ui, true, 999, wsHandler)
    ).rejects.toThrow('Timeout must be at least 1000ms');
  });

  it('should handle timeout in blocking mode', async () => {
    vi.useFakeTimers();
    const ui = createBasicUIComponent();

    const promise = renderUI('/test/project', 'test-session', ui, true, 2000, wsHandler);

    vi.advanceTimersByTime(3000);

    await expect(promise).rejects.toThrow('UI interaction timeout after 2000ms');

    vi.useRealTimers();
  });

  it('should return correct response structure in non-blocking mode', async () => {
    const ui = createBasicUIComponent();
    const result = await renderUI(
      '/test/project',
      'test-session',
      ui,
      false,
      undefined,
      wsHandler
    );

    expect(result).toEqual({
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    });
  });
});

// ============================================================================
// UPDATE_UI TOOL INTEGRATION TESTS
// ============================================================================

describe('update_ui Tool Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute updateUI with valid parameters', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const patch = { props: { title: 'Updated' } };
    const result = await updateUI('/test/project', 'test-session', patch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('UI updated');
  });

  it('should validate patch parameter', async () => {
    await expect(
      updateUI('/test/project', 'test-session', null as any)
    ).rejects.toThrow('patch must be a valid object');
  });

  it('should reject array patch', async () => {
    await expect(
      updateUI('/test/project', 'test-session', [] as any)
    ).rejects.toThrow('patch must be a valid object');
  });

  it('should handle empty patch object', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Patch applied' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI('/test/project', 'test-session', {});
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
  });

  it('should handle nested patch objects', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Complex patch applied' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const complexPatch = {
      props: {
        nested: {
          value: 'test',
          deep: {
            data: [1, 2, 3],
          },
        },
      },
    };

    const result = await updateUI('/test/project', 'test-session', complexPatch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ patch: complexPatch }),
      })
    );
  });

  it('should handle API errors gracefully', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Server error' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      updateUI('/test/project', 'test-session', { props: {} })
    ).rejects.toThrow('Failed to update UI: Server error');
  });

  it('should handle network errors', async () => {
    const networkError = new Error('Network error');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    await expect(
      updateUI('/test/project', 'test-session', { props: {} })
    ).rejects.toThrow('Network error');
  });

  it('should properly encode URL parameters', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const specialProject = '/path/with spaces/project';
    const specialSession = 'session-with-@special!chars';

    await updateUI(specialProject, specialSession, { props: {} });

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('project=');
    expect(callUrl).toContain('session=');
    expect(callUrl).not.toContain(' ');
  });
});

// ============================================================================
// DISMISS_UI TOOL INTEGRATION TESTS
// ============================================================================

describe('dismiss_ui Tool Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute dismissUI with valid parameters', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await dismissUI('/test/project', 'test-session');
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('UI dismissed');
  });

  it('should use default message when server does not provide one', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await dismissUI('/test/project', 'test-session');
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('UI dismissed successfully');
  });

  it('should send POST request to correct endpoint', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await dismissUI('/test/project', 'test-session');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/dismiss-ui'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  });

  it('should handle API errors gracefully', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Server error' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      dismissUI('/test/project', 'test-session')
    ).rejects.toThrow('Failed to dismiss UI: Server error');
  });

  it('should handle network errors', async () => {
    const networkError = new Error('Network connection failed');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    await expect(
      dismissUI('/test/project', 'test-session')
    ).rejects.toThrow('Network connection failed');
  });

  it('should handle non-JSON error responses', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Bad Request',
      json: async () => {
        throw new Error('Invalid JSON');
      },
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      dismissUI('/test/project', 'test-session')
    ).rejects.toThrow('Failed to dismiss UI: Bad Request');
  });

  it('should properly encode URL parameters', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const specialProject = '/path/with spaces/project';
    const specialSession = 'session-with-@special!chars';

    await dismissUI(specialProject, specialSession);

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('project=');
    expect(callUrl).toContain('session=');
    expect(callUrl).not.toContain(' ');
  });
});

// ============================================================================
// INTEGRATION SCENARIO TESTS
// ============================================================================

describe('MCP Tools Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle complete UI workflow: render -> update -> dismiss', async () => {
    const wsHandler = new WebSocketHandler();
    const broadcastSpy = vi.spyOn(wsHandler, 'broadcast');

    // 1. Render UI
    const ui = createBasicUIComponent();
    const renderResult = await renderUI(
      '/test/project',
      'test-session',
      ui,
      false,
      undefined,
      wsHandler
    );

    expect(renderResult.completed).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    // 2. Update UI
    const mockUpdateResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockUpdateResponse);

    const updateResult = await updateUI('/test/project', 'test-session', {
      props: { status: 'loading' },
    });
    const updateParsed = JSON.parse(updateResult);
    expect(updateParsed.success).toBe(true);

    // 3. Dismiss UI
    const mockDismissResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockDismissResponse);

    const dismissResult = await dismissUI('/test/project', 'test-session');
    const dismissParsed = JSON.parse(dismissResult);
    expect(dismissParsed.success).toBe(true);
  });

  it('should handle errors at each stage of workflow', async () => {
    const wsHandler = new WebSocketHandler();

    // Invalid UI structure
    const invalidUI = { type: 'Button' };
    await expect(
      renderUI('/test/project', 'test-session', invalidUI, false, undefined, wsHandler)
    ).rejects.toThrow();

    // Invalid patch
    await expect(
      updateUI('/test/project', 'test-session', null as any)
    ).rejects.toThrow();

    // Network error on dismiss
    const networkError = new Error('Connection failed');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    await expect(
      dismissUI('/test/project', 'test-session')
    ).rejects.toThrow('Connection failed');
  });

  it('should handle multiple concurrent render operations', async () => {
    const wsHandler1 = new WebSocketHandler();
    const wsHandler2 = new WebSocketHandler();
    const broadcastSpy1 = vi.spyOn(wsHandler1, 'broadcast');
    const broadcastSpy2 = vi.spyOn(wsHandler2, 'broadcast');

    const ui = createBasicUIComponent();

    const results = await Promise.all([
      renderUI('/project1', 'session1', ui, false, undefined, wsHandler1),
      renderUI('/project2', 'session2', ui, false, undefined, wsHandler2),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].completed).toBe(true);
    expect(results[1].completed).toBe(true);
    expect(broadcastSpy1).toHaveBeenCalled();
    expect(broadcastSpy2).toHaveBeenCalled();

    // Verify broadcasts had different UI IDs
    const msg1 = broadcastSpy1.mock.calls[0][0];
    const msg2 = broadcastSpy2.mock.calls[0][0];
    expect(msg1.uiId).not.toBe(msg2.uiId);
  });

  it('should validate all required parameters are checked', async () => {
    const wsHandler = new WebSocketHandler();
    const ui = createBasicUIComponent();
    const patch = { props: {} };

    // Missing parameters should fail validation
    const testCases = [
      {
        name: 'render_ui without project',
        fn: () => renderUI('', 'session', ui, false, undefined, wsHandler),
        error: 'project must be a non-empty string',
      },
      {
        name: 'render_ui without session',
        fn: () => renderUI('/project', '', ui, false, undefined, wsHandler),
        error: 'session must be a non-empty string',
      },
      {
        name: 'update_ui without patch',
        fn: () => updateUI('/project', 'session', null as any),
        error: 'patch must be a valid object',
      },
    ];

    for (const testCase of testCases) {
      await expect(testCase.fn()).rejects.toThrow(testCase.error);
    }
  });
});

// ============================================================================
// RESPONSE FORMAT TESTS
// ============================================================================

describe('Tool Response Formats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return JSON stringified responses from updateUI', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI('/test/project', 'test-session', { props: {} });

    // Should be valid JSON string
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('should return JSON stringified responses from dismissUI', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await dismissUI('/test/project', 'test-session');

    // Should be valid JSON string
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('should return RenderUIResponse object from renderUI', async () => {
    const wsHandler = new WebSocketHandler();
    const ui = createBasicUIComponent();

    const result = await renderUI('/test/project', 'test-session', ui, false, undefined, wsHandler);

    // renderUI returns RenderUIResponse object (not stringified)
    expect(result).toEqual({
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    });
  });
});
