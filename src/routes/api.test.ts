import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleAPI } from './api';
import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { SnippetManager } from '../services/snippet-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { ProjectRegistry, projectRegistry } from '../services/project-registry';
import { sessionRegistry } from '../services/session-registry';
import { uiManager, type UIResponse } from '../services/ui-manager';

describe('API Projects Endpoints', () => {
  let testRegistryPath: string;
  let testProjectPath: string;
  let testProjectPath2: string;

  // Mock dependencies
  let mockValidator: Validator;
  let mockRenderer: Renderer;
  let mockWSHandler: WebSocketHandler;

  beforeEach(async () => {
    // Create temporary registry and project paths
    testRegistryPath = join(tmpdir(), `test-api-projects-${Date.now()}.json`);
    // Replace the singleton's registry path for testing
    Object.defineProperty(projectRegistry, 'registryPath', {
      value: testRegistryPath,
      writable: true,
      configurable: true,
    });

    testProjectPath = join(tmpdir(), `test-api-project-${Date.now()}`);
    testProjectPath2 = join(tmpdir(), `test-api-project2-${Date.now()}`);

    await mkdir(testProjectPath, { recursive: true });
    await mkdir(testProjectPath2, { recursive: true });

    // Mock dependencies
    mockValidator = {} as Validator;
    mockRenderer = {} as Renderer;
    mockWSHandler = {} as WebSocketHandler;
  });

  afterEach(async () => {
    // Clean up test files
    if (fs.existsSync(testRegistryPath)) {
      await rm(testRegistryPath, { force: true });
    }
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
    if (fs.existsSync(testProjectPath2)) {
      await rm(testProjectPath2, { recursive: true, force: true });
    }
  });

  describe('GET /api/projects', () => {
    it('should return empty list when no projects registered', async () => {
      const req = new Request('http://localhost/api/projects', { method: 'GET' });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.projects).toEqual([]);
    });

    it('should return list of registered projects', async () => {
      // Register some projects using the singleton
      await projectRegistry.register(testProjectPath);
      await projectRegistry.register(testProjectPath2);

      const req = new Request('http://localhost/api/projects', { method: 'GET' });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.projects).toHaveLength(2);
      expect(data.projects.map((p: any) => p.path)).toContain(testProjectPath);
      expect(data.projects.map((p: any) => p.path)).toContain(testProjectPath2);
    });

    it('should return Project objects with path, name, and lastAccess', async () => {
      await projectRegistry.register(testProjectPath);

      const req = new Request('http://localhost/api/projects', { method: 'GET' });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      const project = data.projects[0];
      expect(project).toHaveProperty('path');
      expect(project).toHaveProperty('name');
      expect(project).toHaveProperty('lastAccess');
      expect(project.path).toBe(testProjectPath);
    });

    it('should sort projects by lastAccess descending', async () => {
      // Register first project
      await projectRegistry.register(testProjectPath);
      // Wait a bit then register second
      await new Promise(resolve => setTimeout(resolve, 100));
      await projectRegistry.register(testProjectPath2);

      const req = new Request('http://localhost/api/projects', { method: 'GET' });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      const data = await response.json() as any;
      expect(data.projects[0].path).toBe(testProjectPath2);
      expect(data.projects[1].path).toBe(testProjectPath);
    });
  });

  describe('POST /api/projects', () => {
    it('should register a new project and return 201', async () => {
      const body = { path: testProjectPath };
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.project).toBeDefined();
      expect(data.project.path).toBe(testProjectPath);
      expect(data.project.name).toBeTruthy();
      expect(data.project.lastAccess).toBeTruthy();
    });

    it('should return 400 if path is missing', async () => {
      const body = {};
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should return 400 if path is relative', async () => {
      const body = { path: 'relative/path' };
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should return 400 if path does not exist', async () => {
      const body = { path: '/non/existent/path' };
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should update lastAccess if project already registered', async () => {
      // Register once
      await projectRegistry.register(testProjectPath);
      const firstData = await projectRegistry.load();
      const firstTime = firstData.projects[0].lastAccess;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Register again via API
      const body = { path: testProjectPath };
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.project.lastAccess).not.toBe(firstTime);
    });

    it('should persist registered project to registry', async () => {
      const body = { path: testProjectPath };
      const req = new Request('http://localhost/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Verify persisted via registry
      const projects = await projectRegistry.list();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe(testProjectPath);
    });
  });

  describe('DELETE /api/projects', () => {
    beforeEach(async () => {
      // Register a project before each test
      await projectRegistry.register(testProjectPath);
      await projectRegistry.register(testProjectPath2);
    });

    it('should unregister a project and return 200', async () => {
      const req = new Request(`http://localhost/api/projects?path=${encodeURIComponent(testProjectPath)}`, {
        method: 'DELETE',
      });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
    });

    it('should return 404 if project not found', async () => {
      const req = new Request(
        `http://localhost/api/projects?path=${encodeURIComponent('/non/existent/path')}`,
        { method: 'DELETE' }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should return 400 if path query parameter is missing', async () => {
      const req = new Request('http://localhost/api/projects', { method: 'DELETE' });
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should remove only the specified project', async () => {
      const req = new Request(`http://localhost/api/projects?path=${encodeURIComponent(testProjectPath)}`, {
        method: 'DELETE',
      });
      await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Verify only one removed
      const projects = await projectRegistry.list();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe(testProjectPath2);
    });

    it('should persist unregistration to registry', async () => {
      const req = new Request(`http://localhost/api/projects?path=${encodeURIComponent(testProjectPath)}`, {
        method: 'DELETE',
      });
      await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Verify persisted via registry
      const projects = await projectRegistry.list();
      expect(projects).not.toContainEqual(expect.objectContaining({ path: testProjectPath }));
    });
  });

  describe('POST /api/render-ui', () => {
    let mockBroadcast: any;

    beforeEach(() => {
      // Mock the WebSocket handler's broadcast method
      mockBroadcast = vi.fn();
      mockWSHandler = {
        broadcast: mockBroadcast,
      } as any;
    });

    it('should accept ui and blocking parameters without timeout', async () => {
      const body = {
        ui: { type: 'Card', title: 'Test' },
        blocking: false,
      };
      const req = new Request(
        'http://localhost/api/render-ui?project=/test/project&session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.uiId).toBeDefined();
    });

    it('should reject request if timeout is sent (not destructured)', async () => {
      // Even though timeout is sent, it should be ignored and not cause an error
      const body = {
        ui: { type: 'Card', title: 'Test' },
        blocking: false,
        timeout: 5000, // This should be ignored
      };
      const req = new Request(
        'http://localhost/api/render-ui?project=/test/project&session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Should succeed because timeout is simply ignored
      expect(response.status).toBe(200);
    });

    it('should return 400 if ui is missing', async () => {
      const body = {
        blocking: false,
      };
      const req = new Request(
        'http://localhost/api/render-ui?project=/test/project&session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBeTruthy();
    });

    it('should return 400 if project query param is missing', async () => {
      const body = {
        ui: { type: 'Card', title: 'Test' },
        blocking: false,
      };
      const req = new Request(
        'http://localhost/api/render-ui?session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBeTruthy();
    });

    it('should broadcast ui_render message to WebSocket', async () => {
      const body = {
        ui: { type: 'Card', title: 'Test' },
        blocking: false,
      };
      const req = new Request(
        'http://localhost/api/render-ui?project=/test/project&session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Verify broadcast was called with ui_render message
      expect(mockBroadcast).toHaveBeenCalled();
      const broadcastCall = mockBroadcast.mock.calls[0][0];
      expect(broadcastCall.type).toBe('ui_render');
      expect(broadcastCall.project).toBe('/test/project');
      expect(broadcastCall.session).toBe('test-session');
      expect(broadcastCall.ui).toEqual({ type: 'Card', title: 'Test' });
    });

    it('should use default blocking=true if not specified', async () => {
      const body = {
        ui: { type: 'Card', title: 'Test' },
      };
      const req = new Request(
        'http://localhost/api/render-ui?project=/test/project&session=test-session',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      // Create a promise that will be resolved after a short delay to simulate a response
      const responsePromise = handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      // Give it a moment to broadcast, then respond to the UI
      await new Promise(resolve => setTimeout(resolve, 100));

      // Find the session key and respond to the UI
      const broadcastCall = mockBroadcast.mock.calls[0][0];
      const sessionKey = `${broadcastCall.project}:${broadcastCall.session}`;
      const uiId = broadcastCall.uiId;

      // Send a response to resolve the pending UI
      uiManager.receiveResponse(sessionKey, uiId, {
        source: 'browser',
        action: 'confirm',
        data: {},
      });

      // Now wait for the API response
      const response = await responsePromise;
      expect(response.status).toBe(200);

      // Verify broadcast was called with blocking=true
      expect(broadcastCall.blocking).toBe(true);
    });
  });

  describe('Terminal API Endpoints', () => {
    let mockWSHandler2: WebSocketHandler;

    beforeEach(() => {
      mockWSHandler2 = {
        broadcast: vi.fn(),
      } as any;
    });

    describe('GET /api/terminal/sessions', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/terminal/sessions', { method: 'GET' });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should return empty list when no sessions exist', async () => {
        const req = new Request('http://localhost/api/terminal/sessions?project=/tmp/test&session=test-session', { method: 'GET' });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.sessions).toBeDefined();
        expect(Array.isArray(data.sessions)).toBe(true);
      });
    });

    describe('DELETE /api/terminal/sessions/:id', () => {
      it('should require project and session query params', async () => {
        const deleteReq = new Request('http://localhost/api/terminal/sessions/nonexistent', {
          method: 'DELETE',
        });
        const response = await handleAPI(deleteReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should return 404 if session does not exist', async () => {
        const deleteReq = new Request('http://localhost/api/terminal/sessions/nonexistent?project=/tmp/test&session=test-session', {
          method: 'DELETE',
        });
        const response = await handleAPI(deleteReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(404);
        const data = await response.json() as any;
        expect(data.error).toContain('not found');
      });
    });

    describe('POST /api/terminal/sessions/:id/rename', () => {
      it('should require project and session query params', async () => {
        const renameReq = new Request('http://localhost/api/terminal/sessions/nonexistent/rename', {
          method: 'POST',
          body: JSON.stringify({ name: 'new-name' }),
        });
        const response = await handleAPI(renameReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should return 404 if session does not exist', async () => {
        const renameReq = new Request('http://localhost/api/terminal/sessions/nonexistent/rename?project=/tmp/test&session=test-session', {
          method: 'POST',
          body: JSON.stringify({ name: 'new-name' }),
        });
        const response = await handleAPI(renameReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler2);

        expect(response.status).toBe(404);
        const data = await response.json() as any;
        expect(data.error).toContain('not found');
      });
    });
  });

  describe('Snippet API Endpoints', () => {
    let testRegistryPath: string;
    let testProjectPath: string;
    let mockValidator: Validator;
    let mockRenderer: Renderer;
    let mockWSHandler: WebSocketHandler;

    beforeEach(async () => {
      testRegistryPath = join(tmpdir(), `test-api-snippets-${Date.now()}.json`);
      Object.defineProperty(projectRegistry, 'registryPath', {
        value: testRegistryPath,
        writable: true,
        configurable: true,
      });

      testProjectPath = join(tmpdir(), `test-api-snippet-project-${Date.now()}`);
      await mkdir(testProjectPath, { recursive: true });

      // Create snippet session directory
      const sessionPath = join(testProjectPath, '.collab', 'test-session');
      await mkdir(sessionPath, { recursive: true });
      const snippetsPath = join(sessionPath, 'snippets');
      await mkdir(snippetsPath, { recursive: true });

      // Register project and session
      await projectRegistry.register(testProjectPath);
      await sessionRegistry.register(testProjectPath, 'test-session');

      mockValidator = {} as Validator;
      mockRenderer = {} as Renderer;
      mockWSHandler = {
        broadcast: vi.fn(),
        getConnectionCount: () => 1,
      } as any;
    });

    afterEach(async () => {
      if (fs.existsSync(testRegistryPath)) {
        await rm(testRegistryPath, { force: true });
      }
      if (fs.existsSync(testProjectPath)) {
        await rm(testProjectPath, { recursive: true, force: true });
      }
    });

    describe('POST /api/snippet (create)', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/snippet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test', content: '{}' }),
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should require name and content fields', async () => {
        const req = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test' }),
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('Name and content');
      });

      it('should create a snippet successfully', async () => {
        const req = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'console.log("test");' }),
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.success).toBe(true);
        expect(data.id).toBeDefined();
        expect(mockWSHandler.broadcast).toHaveBeenCalled();
      });
    });

    describe('GET /api/snippets (list)', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/snippets', { method: 'GET' });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should return empty list when no snippets exist', async () => {
        const req = new Request(`http://localhost/api/snippets?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.snippets).toEqual([]);
      });

      it('should list created snippets', async () => {
        // Create a snippet first
        const createReq = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'console.log("test");' }),
        });
        await handleAPI(createReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        // List snippets
        const listReq = new Request(`http://localhost/api/snippets?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const response = await handleAPI(listReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(Array.isArray(data.snippets)).toBe(true);
        expect(data.snippets.length).toBe(1);
        expect(data.snippets[0].id).toBe('test-snippet');
      });
    });

    describe('GET /api/snippet/:id (get)', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/snippet/test', { method: 'GET' });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should return 404 for non-existent snippet', async () => {
        const req = new Request(`http://localhost/api/snippet/nonexistent?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(404);
        const data = await response.json() as any;
        expect(data.error).toContain('not found');
      });

      it('should retrieve a snippet by id', async () => {
        // Create a snippet first
        const createReq = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'console.log("test");' }),
        });
        await handleAPI(createReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        // Get the snippet
        const getReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const response = await handleAPI(getReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.id).toBe('test-snippet');
        expect(data.content).toBe('console.log("test");');
        expect(data.lastModified).toBeDefined();
      });
    });

    describe('POST /api/snippet/:id (update)', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/snippet/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'updated' }),
        });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should require content field', async () => {
        const createReq = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'original' }),
        });
        await handleAPI(createReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        const updateReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const response = await handleAPI(updateReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('Content');
      });

      it('should update snippet content', async () => {
        // Create a snippet first
        const createReq = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'original' }),
        });
        await handleAPI(createReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        // Update the snippet
        const updateReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'updated content' }),
        });
        const response = await handleAPI(updateReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.success).toBe(true);

        // Verify the update
        const getReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const getResponse = await handleAPI(getReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);
        const getData = await getResponse.json() as any;
        expect(getData.content).toBe('updated content');
      });
    });

    describe('DELETE /api/snippet/:id (delete)', () => {
      it('should require project and session query params', async () => {
        const req = new Request('http://localhost/api/snippet/test', { method: 'DELETE' });
        const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data.error).toContain('project and session');
      });

      it('should delete a snippet', async () => {
        // Create a snippet first
        const createReq = new Request(`http://localhost/api/snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test-snippet', content: 'content' }),
        });
        await handleAPI(createReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        // Delete the snippet
        const deleteReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'DELETE',
        });
        const response = await handleAPI(deleteReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.success).toBe(true);

        // Verify deletion
        const getReq = new Request(`http://localhost/api/snippet/test-snippet?project=${encodeURIComponent(testProjectPath)}&session=test-session`, {
          method: 'GET',
        });
        const getResponse = await handleAPI(getReq, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);
        expect(getResponse.status).toBe(404);
      });
    });
  });
});
