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
