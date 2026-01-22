/**
 * Tests for update-ui MCP tool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { updateUI, updateUISchema } from '../update-ui';

// Mock fetch globally
global.fetch = vi.fn();

describe('updateUI', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';
  const mockApiUrl = `http://localhost:3737/api/update-ui?project=${encodeURIComponent(mockProject)}&session=${encodeURIComponent(mockSession)}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully update UI with a valid patch', async () => {
    const mockPatch = {
      props: {
        title: 'Updated Title',
      },
    };

    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, mockPatch);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      success: true,
      message: 'UI updated',
    });
    expect(global.fetch).toHaveBeenCalledWith(mockApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: mockPatch }),
    });
  });

  it('should use default message when server does not provide one', async () => {
    const mockPatch = { props: { value: 50 } };
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, mockPatch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('UI updated successfully');
  });

  it('should handle complex nested patch objects', async () => {
    const complexPatch = {
      props: {
        tabs: [
          {
            id: 'tab-1',
            label: 'New Label',
            content: {
              type: 'Card',
              props: {
                title: 'Nested Card',
              },
            },
          },
        ],
        activeTab: 'tab-1',
      },
    };

    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Complex patch applied' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, complexPatch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ patch: complexPatch }),
      })
    );
  });

  it('should throw error on failed response', async () => {
    const mockPatch = { props: { visible: false } };
    const mockResponse = {
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Server error occurred' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      updateUI(mockProject, mockSession, mockPatch)
    ).rejects.toThrow('Failed to update UI: Server error occurred');
  });

  it('should throw error when patch is not an object', async () => {
    await expect(
      updateUI(mockProject, mockSession, null as any)
    ).rejects.toThrow('patch must be a valid object');
  });

  it('should throw error when patch is a string', async () => {
    await expect(
      updateUI(mockProject, mockSession, 'invalid' as any)
    ).rejects.toThrow('patch must be a valid object');
  });

  it('should throw error when patch is an array', async () => {
    await expect(
      updateUI(mockProject, mockSession, [] as any)
    ).rejects.toThrow('patch must be a valid object');
  });

  it('should handle fetch errors', async () => {
    const mockPatch = { props: {} };
    const networkError = new Error('Network error');
    (global.fetch as any).mockRejectedValueOnce(networkError);

    await expect(
      updateUI(mockProject, mockSession, mockPatch)
    ).rejects.toThrow('Network error');
  });

  it('should handle non-JSON error responses', async () => {
    const mockPatch = { props: {} };
    const mockResponse = {
      ok: false,
      statusText: 'Bad Request',
      json: async () => {
        throw new Error('Invalid JSON');
      },
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      updateUI(mockProject, mockSession, mockPatch)
    ).rejects.toThrow('Failed to update UI: Bad Request');
  });

  it('should encode special characters in URL params', async () => {
    const specialProject = '/path/with spaces/project';
    const specialSession = 'session-with-special-chars!@#';
    const mockPatch = { props: { text: 'updated' } };
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'UI updated' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await updateUI(specialProject, specialSession, mockPatch);

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('project=');
    expect(callUrl).toContain('session=');
    // Verify URL encoding
    expect(callUrl).not.toContain(' ');
  });

  it('should handle empty patch object', async () => {
    const emptyPatch = {};
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Empty patch applied' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, emptyPatch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ patch: emptyPatch }),
      })
    );
  });

  it('should handle patch with multiple top-level keys', async () => {
    const multiKeyPatch = {
      type: 'Card',
      props: { title: 'New Title', backgroundColor: '#fff' },
      children: [],
    };

    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Multi-key patch applied' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, multiKeyPatch);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ patch: multiKeyPatch }),
      })
    );
  });

  it('should correctly JSON stringify result with proper formatting', async () => {
    const mockPatch = { props: {} };
    const mockResponse = {
      ok: true,
      json: async () => ({ message: 'Test message' }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const result = await updateUI(mockProject, mockSession, mockPatch);

    // Verify it's valid JSON with proper formatting
    const parsed = JSON.parse(result);
    expect(result).toBe(
      JSON.stringify(
        {
          success: true,
          message: 'Test message',
        },
        null,
        2
      )
    );
  });

  it('should maintain POST method for API request', async () => {
    const mockPatch = { props: { status: 'active' } };
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await updateUI(mockProject, mockSession, mockPatch);

    const callOptions = (global.fetch as any).mock.calls[0][1];
    expect(callOptions.method).toBe('POST');
  });

  it('should set correct Content-Type header', async () => {
    const mockPatch = { props: {} };
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await updateUI(mockProject, mockSession, mockPatch);

    const callOptions = (global.fetch as any).mock.calls[0][1];
    expect(callOptions.headers['Content-Type']).toBe('application/json');
  });

  it('should handle server error with custom error message', async () => {
    const mockPatch = { props: { data: 'test' } };
    const mockResponse = {
      ok: false,
      statusText: 'Unauthorized',
      json: async () => ({
        error: 'User not authorized to update UI',
      }),
    };
    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    await expect(
      updateUI(mockProject, mockSession, mockPatch)
    ).rejects.toThrow('Failed to update UI: User not authorized to update UI');
  });
});

describe('updateUISchema', () => {
  it('should define correct schema structure', () => {
    expect(updateUISchema).toEqual({
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
        patch: {
          type: 'object',
          description: 'Partial UI component patch to apply to current UI',
          additionalProperties: true,
        },
      },
      required: ['project', 'session', 'patch'],
    });
  });

  it('should have all required fields', () => {
    expect(updateUISchema.required).toContain('project');
    expect(updateUISchema.required).toContain('session');
    expect(updateUISchema.required).toContain('patch');
    expect(updateUISchema.required.length).toBe(3);
  });

  it('should define string types for project and session', () => {
    expect(updateUISchema.properties.project.type).toBe('string');
    expect(updateUISchema.properties.session.type).toBe('string');
  });

  it('should define object type for patch with additional properties allowed', () => {
    expect(updateUISchema.properties.patch.type).toBe('object');
    expect(updateUISchema.properties.patch.additionalProperties).toBe(true);
  });

  it('should have proper descriptions for all properties', () => {
    expect(updateUISchema.properties.project.description).toContain(
      'project root directory'
    );
    expect(updateUISchema.properties.session.description).toContain('Session name');
    expect(updateUISchema.properties.patch.description).toContain(
      'Partial UI component patch'
    );
  });
});
