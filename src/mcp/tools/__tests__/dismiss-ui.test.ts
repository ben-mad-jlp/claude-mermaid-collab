/**
 * Tests for dismiss-ui MCP tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dismissUI, dismissUISchema } from '../dismiss-ui';

// Mock fetch globally
global.fetch = vi.fn();

describe('dismissUI', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';
  const mockApiUrl = `http://localhost:3737/api/dismiss-ui?project=${encodeURIComponent(mockProject)}&session=${encodeURIComponent(mockSession)}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully dismiss UI', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await dismissUI(mockProject, mockSession);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      success: true,
      message: 'UI dismissed',
    });
    expect(global.fetch).toHaveBeenCalledWith(mockApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('should use default message when server does not provide one', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await dismissUI(mockProject, mockSession);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('UI dismissed successfully');
  });

  it('should throw error on failed response', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Server error occurred' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(dismissUI(mockProject, mockSession)).rejects.toThrow(
      'Failed to dismiss UI: Server error occurred'
    );
  });

  it('should handle fetch errors', async () => {
    const networkError = new Error('Network error');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    await expect(dismissUI(mockProject, mockSession)).rejects.toThrow(
      'Network error'
    );
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

    await expect(dismissUI(mockProject, mockSession)).rejects.toThrow(
      'Failed to dismiss UI: Bad Request'
    );
  });

  it('should encode special characters in URL params', async () => {
    const specialProject = '/path/with spaces/project';
    const specialSession = 'session-with-special-chars!@#';
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI dismissed' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await dismissUI(specialProject, specialSession);

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('project=');
    expect(callUrl).toContain('session=');
    // Verify URL encoding
    expect(callUrl).not.toContain(' ');
  });
});

describe('dismissUISchema', () => {
  it('should define correct schema structure', () => {
    expect(dismissUISchema).toEqual({
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Absolute path to the project root directory',
        },
        session: {
          type: 'string',
          description: 'Session name (e.g., "bright-calm-river")',
        },
      },
      required: ['project', 'session'],
    });
  });

  it('should have both project and session as required', () => {
    expect(dismissUISchema.required).toContain('project');
    expect(dismissUISchema.required).toContain('session');
    expect(dismissUISchema.required.length).toBe(2);
  });

  it('should define string types for both properties', () => {
    expect(dismissUISchema.properties.project.type).toBe('string');
    expect(dismissUISchema.properties.session.type).toBe('string');
  });
});
