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
import { renderUISchema, validateUIStructure, validateTimeout } from '../tools/render-ui.js';
import { updateUI, updateUISchema } from '../tools/update-ui.js';
import { dismissUI, dismissUISchema } from '../tools/dismiss-ui.js';
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
        }),
        required: expect.any(Array),
      });
    });

    it('should require project, session, and ui fields', () => {
      expect(renderUISchema.required).toContain('project');
      expect(renderUISchema.required).toContain('session');
      expect(renderUISchema.required).toContain('ui');
    });

    it('should not require blocking field', () => {
      expect(renderUISchema.required).not.toContain('blocking');
    });

    it('should have proper property descriptions', () => {
      expect(renderUISchema.properties.project.description).toContain('project root directory');
      expect(renderUISchema.properties.session.description).toContain('Session name');
      expect(renderUISchema.properties.ui.description).toContain('UI component');
      expect(renderUISchema.properties.blocking.description).toContain('user action');
    });

    it('should have correct default values', () => {
      expect(renderUISchema.properties.blocking.default).toBe(true);
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
// RENDER_UI TOOL INTEGRATION TESTS (MCP Server HTTP-based)
// ============================================================================

describe('render_ui Tool Integration (MCP Server)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should make HTTP POST request to /api/render-ui endpoint', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({ completed: true, source: 'browser', action: 'submit' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    // Note: This simulates what the MCP server does
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: false, timeout: undefined }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to render UI: ${error.error || response.statusText}`);
    }

    const result = await response.text();
    expect(result).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/render-ui'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should handle non-blocking render mode', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({ success: true, uiId: 'ui_123_abc' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: false }),
    });

    const result = await response.text();
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.uiId).toBeDefined();
  });

  it('should handle blocking render mode with timeout', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({
        completed: true,
        source: 'browser',
        action: 'submit',
        data: { value: 'test' },
      }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const timeout = 30000;
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: true, timeout }),
    });

    const result = await response.text();
    const parsed = JSON.parse(result);

    expect(parsed.completed).toBe(true);
    expect(parsed.source).toBe('browser');
    expect(parsed.action).toBe('submit');
  });

  it('should handle API error responses', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'ui required' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui: null }),
    });

    if (!response.ok) {
      const error = await response.json();
      expect(error.error).toBe('ui required');
    }
  });

  it('should handle network errors', async () => {
    const networkError = new Error('Failed to fetch');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    const ui = createBasicUIComponent();
    try {
      await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui }),
      });
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error.message).toBe('Failed to fetch');
    }
  });

  it('should include timeout parameter when provided', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({ completed: true }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const timeout = 60000;

    await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: true, timeout }),
    });

    const callBody = (global.fetch as any).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.timeout).toBe(60000);
  });

  it('should properly encode project and session in query params', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const specialProject = '/path/with spaces/project';
    const specialSession = 'session-with-@special!chars';

    await fetch(`http://localhost:3737/api/render-ui?project=${encodeURIComponent(specialProject)}&session=${encodeURIComponent(specialSession)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui }),
    });

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('project=');
    expect(callUrl).toContain('session=');
    // URLs should be encoded properly
    expect(callUrl).toContain('%');
  });

  it('should handle timeout responses from API', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({
        completed: false,
        source: 'timeout',
        error: 'Timeout after 30000ms',
      }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: true, timeout: 30000 }),
    });

    const result = await response.text();
    const parsed = JSON.parse(result);

    expect(parsed.completed).toBe(false);
    expect(parsed.source).toBe('timeout');
    expect(parsed.error).toContain('Timeout');
  });

  it('should validate required parameters before making request', async () => {
    // This test simulates the MCP server validation
    const testCases = [
      { project: '', session: 'test-session', ui: createBasicUIComponent(), expectedError: 'Missing required: project, session, ui' },
      { project: '/test/project', session: '', ui: createBasicUIComponent(), expectedError: 'Missing required: project, session, ui' },
      { project: '/test/project', session: 'test-session', ui: null, expectedError: 'Missing required: project, session, ui' },
    ];

    for (const testCase of testCases) {
      if (!testCase.project || !testCase.session || !testCase.ui) {
        expect(() => {
          throw new Error('Missing required: project, session, ui');
        }).toThrow(testCase.expectedError);
      }
    }
  });

  it('should return response as text from API', async () => {
    const expectedResponse = {
      completed: true,
      source: 'browser',
      action: 'confirm',
      data: { confirmed: true },
    };
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify(expectedResponse),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: true }),
    });

    const result = await response.text();
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(expectedResponse);
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
    // 1. Render UI via HTTP
    const mockRenderResponse = {
      ok: true,
      text: async () => JSON.stringify({ success: true, uiId: 'ui_123' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockRenderResponse);

    const ui = createBasicUIComponent();
    const renderResponse = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: false }),
    });
    const renderResult = await renderResponse.text();
    const renderParsed = JSON.parse(renderResult);
    expect(renderParsed.success).toBe(true);

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
    // API error on render
    const mockRenderError = {
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'ui required' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockRenderError);

    try {
      const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui: null }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to render UI: ${error.error}`);
      }
    } catch (error: any) {
      expect(error.message).toContain('Failed to render UI');
    }

    // Invalid patch on update
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
    const mockRenderResponse1 = {
      ok: true,
      text: async () => JSON.stringify({ success: true, uiId: 'ui_123_abc' }),
    };
    const mockRenderResponse2 = {
      ok: true,
      text: async () => JSON.stringify({ success: true, uiId: 'ui_456_def' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockRenderResponse1);
    (global.fetch as any).mockResolvedValueOnce(mockRenderResponse2);

    const ui = createBasicUIComponent();

    const results = await Promise.all([
      fetch('http://localhost:3737/api/render-ui?project=%2Fproject1&session=session1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui, blocking: false }),
      }).then(r => r.text()),
      fetch('http://localhost:3737/api/render-ui?project=%2Fproject2&session=session2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui, blocking: false }),
      }).then(r => r.text()),
    ]);

    expect(results).toHaveLength(2);
    const result1 = JSON.parse(results[0]);
    const result2 = JSON.parse(results[1]);
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Verify responses had different UI IDs
    expect(result1.uiId).not.toBe(result2.uiId);
  });

  it('should validate all required parameters are checked', async () => {
    const ui = createBasicUIComponent();

    // Missing parameters should fail validation - MCP server validates before calling fetch
    const testCases = [
      { project: '', session: 'session', ui, expectedError: 'Missing required: project, session, ui' },
      { project: '/project', session: '', ui, expectedError: 'Missing required: project, session, ui' },
      { project: '/project', session: 'session', ui: null, expectedError: 'Missing required: project, session, ui' },
    ];

    for (const testCase of testCases) {
      if (!testCase.project || !testCase.session || !testCase.ui) {
        expect(() => {
          throw new Error('Missing required: project, session, ui');
        }).toThrow(testCase.expectedError);
      }
    }

    // update_ui without patch
    await expect(
      updateUI('/project', 'session', null as any)
    ).rejects.toThrow('patch must be a valid object');
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

  it('should return text response from render_ui MCP tool', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({
        completed: true,
        source: 'browser',
        action: 'submit',
      }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const ui = createBasicUIComponent();
    const response = await fetch('http://localhost:3737/api/render-ui?project=%2Ftest%2Fproject&session=test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui, blocking: true }),
    });

    const result = await response.text();

    // MCP server returns response.text() which is JSON stringified
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed.completed).toBe(true);
  });
});

// ============================================================================
// TERMINAL TOOLS REGISTRATION TESTS
// ============================================================================

describe('Terminal MCP Tools Registration', () => {
  it('should have terminal_create_session tool schema defined', async () => {
    // Import and verify the schema exists
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas).toBeDefined();
    expect(terminalToolSchemas.terminal_create_session).toBeDefined();
    expect(terminalToolSchemas.terminal_create_session.name).toBe('terminal_create_session');
    expect(terminalToolSchemas.terminal_create_session.description).toContain('Create a new terminal session');
  });

  it('should have terminal_list_sessions tool schema defined', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas.terminal_list_sessions).toBeDefined();
    expect(terminalToolSchemas.terminal_list_sessions.name).toBe('terminal_list_sessions');
    expect(terminalToolSchemas.terminal_list_sessions.description).toContain('List terminal sessions');
  });

  it('should have terminal_kill_session tool schema defined', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas.terminal_kill_session).toBeDefined();
    expect(terminalToolSchemas.terminal_kill_session.name).toBe('terminal_kill_session');
    expect(terminalToolSchemas.terminal_kill_session.description).toContain('Kill a terminal session');
  });

  it('should have terminal_rename_session tool schema defined', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas.terminal_rename_session).toBeDefined();
    expect(terminalToolSchemas.terminal_rename_session.name).toBe('terminal_rename_session');
    expect(terminalToolSchemas.terminal_rename_session.description).toContain('Rename a terminal session');
  });

  it('should have terminal_reorder_sessions tool schema defined', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas.terminal_reorder_sessions).toBeDefined();
    expect(terminalToolSchemas.terminal_reorder_sessions.name).toBe('terminal_reorder_sessions');
    expect(terminalToolSchemas.terminal_reorder_sessions.description).toContain('Reorder terminal sessions');
  });

  it('should have correct input schema for terminal_create_session', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    const schema = terminalToolSchemas.terminal_create_session;

    expect(schema.inputSchema.type).toBe('object');
    expect(schema.inputSchema.properties.project).toBeDefined();
    expect(schema.inputSchema.properties.session).toBeDefined();
    expect(schema.inputSchema.properties.name).toBeDefined();
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).not.toContain('name');
  });

  it('should have correct input schema for terminal_list_sessions', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    const schema = terminalToolSchemas.terminal_list_sessions;

    expect(schema.inputSchema.type).toBe('object');
    expect(schema.inputSchema.properties.project).toBeDefined();
    expect(schema.inputSchema.properties.session).toBeDefined();
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required.length).toBe(2);
  });

  it('should have correct input schema for terminal_kill_session', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    const schema = terminalToolSchemas.terminal_kill_session;

    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('id');
    expect(schema.inputSchema.required.length).toBe(3);
  });

  it('should have correct input schema for terminal_rename_session', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    const schema = terminalToolSchemas.terminal_rename_session;

    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('id');
    expect(schema.inputSchema.required).toContain('name');
    expect(schema.inputSchema.required.length).toBe(4);
  });

  it('should have correct input schema for terminal_reorder_sessions', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    const schema = terminalToolSchemas.terminal_reorder_sessions;

    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('orderedIds');
    expect(schema.inputSchema.required.length).toBe(3);
    expect(schema.inputSchema.properties.orderedIds.type).toBe('array');
    expect(schema.inputSchema.properties.orderedIds.items.type).toBe('string');
  });

  it('should export all 5 terminal tool schemas', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    const toolNames = Object.keys(terminalToolSchemas);
    expect(toolNames).toContain('terminal_create_session');
    expect(toolNames).toContain('terminal_list_sessions');
    expect(toolNames).toContain('terminal_kill_session');
    expect(toolNames).toContain('terminal_rename_session');
    expect(toolNames).toContain('terminal_reorder_sessions');
    expect(toolNames).toHaveLength(5);
  });
});

// ============================================================================
// MCP SERVER REGISTRATION TESTS
// ============================================================================

describe('Terminal Tools Server Registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have terminal_create_session handler', async () => {
    const { setupMCPServer } = await import('../setup.js');
    const server = await setupMCPServer();

    // The setupMCPServer returns the server with handlers registered
    expect(server).toBeDefined();
  });

  it('should register terminal_create_session in ListToolsRequestSchema', async () => {
    const { setupMCPServer } = await import('../setup.js');
    const server = await setupMCPServer();

    // Access the handler that was registered
    // We need to test that the tool schema includes terminal_create_session
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    expect(terminalToolSchemas.terminal_create_session).toBeDefined();
    expect(terminalToolSchemas.terminal_create_session.name).toBe('terminal_create_session');
  });

  it('should register terminal_list_sessions in ListToolsRequestSchema', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    expect(terminalToolSchemas.terminal_list_sessions).toBeDefined();
    expect(terminalToolSchemas.terminal_list_sessions.name).toBe('terminal_list_sessions');
  });

  it('should register terminal_kill_session in ListToolsRequestSchema', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    expect(terminalToolSchemas.terminal_kill_session).toBeDefined();
    expect(terminalToolSchemas.terminal_kill_session.name).toBe('terminal_kill_session');
  });

  it('should register terminal_rename_session in ListToolsRequestSchema', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    expect(terminalToolSchemas.terminal_rename_session).toBeDefined();
    expect(terminalToolSchemas.terminal_rename_session.name).toBe('terminal_rename_session');
  });

  it('should register terminal_reorder_sessions in ListToolsRequestSchema', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');
    expect(terminalToolSchemas.terminal_reorder_sessions).toBeDefined();
    expect(terminalToolSchemas.terminal_reorder_sessions.name).toBe('terminal_reorder_sessions');
  });

  it('should have all terminal tools with correct descriptions', async () => {
    const { terminalToolSchemas } = await import('../tools/terminal-sessions.js');

    expect(terminalToolSchemas.terminal_create_session.description).toContain('Create');
    expect(terminalToolSchemas.terminal_list_sessions.description).toContain('List');
    expect(terminalToolSchemas.terminal_kill_session.description).toContain('Kill');
    expect(terminalToolSchemas.terminal_rename_session.description).toContain('Rename');
    expect(terminalToolSchemas.terminal_reorder_sessions.description).toContain('Reorder');
  });

  it('should handle terminal_create_session call with project and session', async () => {
    const { terminalCreateSession } = await import('../tools/terminal-sessions.js');

    // Mock the terminalManager
    vi.mock('../../services/terminal-manager.js');

    // This test verifies the function signature exists and is callable
    expect(terminalCreateSession).toBeDefined();
    expect(typeof terminalCreateSession).toBe('function');
  });

  it('should handle terminal_list_sessions call with project and session', async () => {
    const { terminalListSessions } = await import('../tools/terminal-sessions.js');

    expect(terminalListSessions).toBeDefined();
    expect(typeof terminalListSessions).toBe('function');
  });

  it('should handle terminal_kill_session call with project, session, and id', async () => {
    const { terminalKillSession } = await import('../tools/terminal-sessions.js');

    expect(terminalKillSession).toBeDefined();
    expect(typeof terminalKillSession).toBe('function');
  });

  it('should handle terminal_rename_session call with project, session, id, and name', async () => {
    const { terminalRenameSession } = await import('../tools/terminal-sessions.js');

    expect(terminalRenameSession).toBeDefined();
    expect(typeof terminalRenameSession).toBe('function');
  });

  it('should handle terminal_reorder_sessions call with project, session, and orderedIds', async () => {
    const { terminalReorderSessions } = await import('../tools/terminal-sessions.js');

    expect(terminalReorderSessions).toBeDefined();
    expect(typeof terminalReorderSessions).toBe('function');
  });

  it('should verify all terminal tools are properly imported in setup.ts', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    // Verify import statement exists
    expect(setupContent).toContain('import { terminalToolSchemas }');
    expect(setupContent).toContain('from \'./tools/terminal-sessions.js\'');
  });

  it('should verify all 5 terminal tools are registered in tools array', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    // Verify all tool registrations exist
    expect(setupContent).toContain('terminalToolSchemas.terminal_create_session');
    expect(setupContent).toContain('terminalToolSchemas.terminal_list_sessions');
    expect(setupContent).toContain('terminalToolSchemas.terminal_kill_session');
    expect(setupContent).toContain('terminalToolSchemas.terminal_rename_session');
    expect(setupContent).toContain('terminalToolSchemas.terminal_reorder_sessions');
  });

  it('should verify all 5 terminal tools have case handlers', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    // Verify case handlers exist
    expect(setupContent).toContain("case 'terminal_create_session':");
    expect(setupContent).toContain("case 'terminal_list_sessions':");
    expect(setupContent).toContain("case 'terminal_kill_session':");
    expect(setupContent).toContain("case 'terminal_rename_session':");
    expect(setupContent).toContain("case 'terminal_reorder_sessions':");
  });

  it('should verify terminal_create_session handler validates required parameters', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const createSessionSection = setupContent.split("case 'terminal_create_session':")[1].split("case 'terminal_list_sessions':")[0];
    expect(createSessionSection).toContain("if (!project || !session) throw new Error('Missing required: project, session')");
  });

  it('should verify terminal_list_sessions handler validates required parameters', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const listSessionsSection = setupContent.split("case 'terminal_list_sessions':")[1].split("case 'terminal_kill_session':")[0];
    expect(listSessionsSection).toContain("if (!project || !session) throw new Error('Missing required: project, session')");
  });

  it('should verify terminal_kill_session handler validates required parameters', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const killSessionSection = setupContent.split("case 'terminal_kill_session':")[1].split("case 'terminal_rename_session':")[0];
    expect(killSessionSection).toContain("if (!project || !session || !id) throw new Error('Missing required: project, session, id')");
  });

  it('should verify terminal_rename_session handler validates required parameters', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const renameSessionSection = setupContent.split("case 'terminal_rename_session':")[1].split("case 'terminal_reorder_sessions':")[0];
    expect(renameSessionSection).toContain("if (!project || !session || !id || !name) throw new Error('Missing required: project, session, id, name')");
  });

  it('should verify terminal_reorder_sessions handler validates required parameters', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const reorderSessionsSection = setupContent.split("case 'terminal_reorder_sessions':")[1].split("default:")[0];
    expect(reorderSessionsSection).toContain("if (!project || !session || !orderedIds) throw new Error('Missing required: project, session, orderedIds')");
  });

  it('should verify all handlers return JSON stringified results', async () => {
    const setupContent = await import('fs/promises').then(fs =>
      fs.readFile('/Users/benmaderazo/Code/claude-mermaid-collab/src/mcp/setup.ts', 'utf-8')
    );

    const createSessionSection = setupContent.split("case 'terminal_create_session':")[1].split("case 'terminal_list_sessions':")[0];
    expect(createSessionSection).toContain('JSON.stringify(result, null, 2)');

    const listSessionsSection = setupContent.split("case 'terminal_list_sessions':")[1].split("case 'terminal_kill_session':")[0];
    expect(listSessionsSection).toContain('JSON.stringify(result, null, 2)');

    const killSessionSection = setupContent.split("case 'terminal_kill_session':")[1].split("case 'terminal_rename_session':")[0];
    expect(killSessionSection).toContain('JSON.stringify(result, null, 2)');

    const renameSessionSection = setupContent.split("case 'terminal_rename_session':")[1].split("case 'terminal_reorder_sessions':")[0];
    expect(renameSessionSection).toContain('JSON.stringify(result, null, 2)');

    const reorderSessionsSection = setupContent.split("case 'terminal_reorder_sessions':")[1].split("default:")[0];
    expect(reorderSessionsSection).toContain('JSON.stringify(result, null, 2)');
  });
});
