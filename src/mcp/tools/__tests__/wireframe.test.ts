/**
 * Tests for wireframe MCP tools
 *
 * Implements create_wireframe, update_wireframe, get_wireframe,
 * list_wireframes, and preview_wireframe tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCreateWireframe,
  handleUpdateWireframe,
  handleGetWireframe,
  handleListWireframes,
  handlePreviewWireframe,
} from '../wireframe';

// Mock fetch
global.fetch = vi.fn();

const API_BASE_URL = 'http://localhost:3737';

// Helper to create mock response
const mockFetch = (status: number, data: any) => {
  (global.fetch as any).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
};

// Helper to create mock error response
const mockFetchError = (status: number, message: string) => {
  (global.fetch as any).mockResolvedValueOnce({
    ok: false,
    status,
    statusText: message,
    json: async () => ({ error: message }),
  });
};

describe('createWireframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully create a wireframe', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const name = 'Test Wireframe';
    const content = {
      viewport: 'mobile',
      direction: 'LR',
      screens: [
        {
          type: 'Screen',
          label: 'Home',
          children: [],
        },
      ],
    };

    mockFetch(200, { id: 'wireframe-123' });

    const result = await handleCreateWireframe(project, session, name, content);

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('id', 'wireframe-123');
    expect(result).toHaveProperty('previewUrl');
    expect(result.previewUrl).toContain('wireframe.html');
    expect(result.previewUrl).toContain('wireframe-123');
  });

  it('should throw error when project is missing', async () => {
    await expect(
      handleCreateWireframe('', 'session', 'name', {})
    ).rejects.toThrow('Missing required: project, session, name, content');
  });

  it('should throw error when session is missing', async () => {
    await expect(
      handleCreateWireframe('project', '', 'name', {})
    ).rejects.toThrow('Missing required: project, session, name, content');
  });

  it('should throw error when name is missing', async () => {
    await expect(
      handleCreateWireframe('project', 'session', '', {})
    ).rejects.toThrow('Missing required: project, session, name, content');
  });

  it('should throw error when content is missing', async () => {
    await expect(
      handleCreateWireframe('project', 'session', 'name', null as any)
    ).rejects.toThrow('Missing required: project, session, name, content');
  });

  it('should throw error on failed creation', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const name = 'Test Wireframe';
    const content = { viewport: 'mobile' };

    mockFetchError(500, 'Internal Server Error');

    await expect(
      handleCreateWireframe(project, session, name, content)
    ).rejects.toThrow('Failed to create wireframe');
  });

  it('should call API with correct parameters', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const name = 'Test Wireframe';
    const content = { viewport: 'mobile' };

    mockFetch(200, { id: 'wireframe-123' });

    await handleCreateWireframe(project, session, name, content);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/wireframe'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('name'),
      })
    );
  });
});

describe('updateWireframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully update a wireframe', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';
    const content = { viewport: 'tablet' };

    mockFetch(200, { id });

    const result = await handleUpdateWireframe(project, session, id, content);

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('id', id);
  });

  it('should throw error when project is missing', async () => {
    await expect(
      handleUpdateWireframe('', 'session', 'id', {})
    ).rejects.toThrow('Missing required: project, session, id, content');
  });

  it('should throw error when session is missing', async () => {
    await expect(
      handleUpdateWireframe('project', '', 'id', {})
    ).rejects.toThrow('Missing required: project, session, id, content');
  });

  it('should throw error when id is missing', async () => {
    await expect(
      handleUpdateWireframe('project', 'session', '', {})
    ).rejects.toThrow('Missing required: project, session, id, content');
  });

  it('should throw error when content is missing', async () => {
    await expect(
      handleUpdateWireframe('project', 'session', 'id', null as any)
    ).rejects.toThrow('Missing required: project, session, id, content');
  });

  it('should throw error on failed update', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';
    const content = { viewport: 'tablet' };

    mockFetchError(500, 'Internal Server Error');

    await expect(
      handleUpdateWireframe(project, session, id, content)
    ).rejects.toThrow('Failed to update wireframe');
  });

  it('should call API with correct parameters', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';
    const content = { viewport: 'tablet' };

    mockFetch(200, { id });

    await handleUpdateWireframe(project, session, id, content);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/wireframe/${id}`),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('viewport'),
      })
    );
  });
});

describe('getWireframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully get a wireframe', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';
    const content = { viewport: 'mobile' };

    mockFetch(200, { id, name: 'Test', content });

    const result = await handleGetWireframe(project, session, id);

    expect(result).toHaveProperty('id', id);
    expect(result).toHaveProperty('content');
  });

  it('should throw error when project is missing', async () => {
    await expect(
      handleGetWireframe('', 'session', 'id')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when session is missing', async () => {
    await expect(
      handleGetWireframe('project', '', 'id')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when id is missing', async () => {
    await expect(
      handleGetWireframe('project', 'session', '')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when wireframe not found', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'nonexistent';

    mockFetchError(404, 'Not Found');

    await expect(
      handleGetWireframe(project, session, id)
    ).rejects.toThrow('Wireframe not found');
  });

  it('should throw error on other failures', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';

    mockFetchError(500, 'Internal Server Error');

    await expect(
      handleGetWireframe(project, session, id)
    ).rejects.toThrow('Failed to get wireframe');
  });
});

describe('listWireframes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully list wireframes', async () => {
    const project = '/test/project';
    const session = 'test-session';

    mockFetch(200, {
      wireframes: [
        { id: 'wf-1', name: 'Wireframe 1', lastModified: 12345 },
        { id: 'wf-2', name: 'Wireframe 2', lastModified: 12346 },
      ],
    });

    const result = await handleListWireframes(project, session);

    expect(result).toHaveProperty('wireframes');
    expect(result.wireframes).toHaveLength(2);
    expect(result.wireframes[0]).toHaveProperty('id', 'wf-1');
  });

  it('should return empty list when no wireframes exist', async () => {
    const project = '/test/project';
    const session = 'test-session';

    mockFetch(200, { wireframes: [] });

    const result = await handleListWireframes(project, session);

    expect(result).toHaveProperty('wireframes');
    expect(result.wireframes).toHaveLength(0);
  });

  it('should throw error when project is missing', async () => {
    await expect(
      handleListWireframes('', 'session')
    ).rejects.toThrow('Missing required: project, session');
  });

  it('should throw error when session is missing', async () => {
    await expect(
      handleListWireframes('project', '')
    ).rejects.toThrow('Missing required: project, session');
  });

  it('should throw error on failed list', async () => {
    const project = '/test/project';
    const session = 'test-session';

    mockFetchError(500, 'Internal Server Error');

    await expect(
      handleListWireframes(project, session)
    ).rejects.toThrow('Failed to list wireframes');
  });
});

describe('previewWireframe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully generate preview URL', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'wireframe-123';

    mockFetch(200, { id });

    const result = await handlePreviewWireframe(project, session, id);

    expect(result).toHaveProperty('id', id);
    expect(result).toHaveProperty('previewUrl');
    expect(result.previewUrl).toContain('wireframe.html');
    expect(result.previewUrl).toContain('wireframe-123');
  });

  it('should throw error when project is missing', async () => {
    await expect(
      handlePreviewWireframe('', 'session', 'id')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when session is missing', async () => {
    await expect(
      handlePreviewWireframe('project', '', 'id')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when id is missing', async () => {
    await expect(
      handlePreviewWireframe('project', 'session', '')
    ).rejects.toThrow('Missing required: project, session, id');
  });

  it('should throw error when wireframe not found', async () => {
    const project = '/test/project';
    const session = 'test-session';
    const id = 'nonexistent';

    mockFetchError(404, 'Not Found');

    await expect(
      handlePreviewWireframe(project, session, id)
    ).rejects.toThrow('Wireframe not found');
  });
});
