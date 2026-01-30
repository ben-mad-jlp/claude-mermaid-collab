import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleAPI } from '../api';
import { DiagramManager } from '../../services/diagram-manager';
import { DocumentManager } from '../../services/document-manager';
import { MetadataManager } from '../../services/metadata-manager';
import { Validator } from '../../services/validator';
import { Renderer } from '../../services/renderer';
import { WebSocketHandler } from '../../websocket/handler';

describe('API Wireframe Routes', () => {
  let testProjectDir: string;
  const testSession = 'test-wireframe-session';

  // Mock dependencies
  let mockValidator: Validator;
  let mockRenderer: Renderer;
  let mockWSHandler: WebSocketHandler;

  beforeEach(async () => {
    testProjectDir = join(tmpdir(), `test-api-wireframe-${Date.now()}`);
    const wireframesDir = join(testProjectDir, '.collab', 'sessions', testSession, 'wireframes');
    await mkdir(wireframesDir, { recursive: true });

    // Mock dependencies
    mockValidator = {} as Validator;
    mockRenderer = {} as Renderer;
    mockWSHandler = { broadcast: () => {} } as any;
  });

  afterEach(async () => {
    if (fs.existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('GET /api/wireframes', () => {
    it('should return empty list when no wireframes exist', async () => {
      const req = new Request(
        `http://localhost/api/wireframes?project=${testProjectDir}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.wireframes).toEqual([]);
    });

    it('should list wireframes in session', async () => {
      // Create a wireframe
      const wireframesDir = join(testProjectDir, '.collab', 'sessions', testSession, 'wireframes');
      const wireframeContent = { viewport: 'mobile', direction: 'LR', screens: [] };
      await writeFile(
        join(wireframesDir, 'test-wf.wireframe.json'),
        JSON.stringify(wireframeContent, null, 2)
      );

      const req = new Request(
        `http://localhost/api/wireframes?project=${testProjectDir}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.wireframes).toHaveLength(1);
      expect(data.wireframes[0].id).toBe('test-wf');
    });
  });

  describe('POST /api/wireframe', () => {
    it('should create a new wireframe', async () => {
      const wireframeContent = { viewport: 'mobile', direction: 'LR', screens: [] };

      const req = new Request(
        `http://localhost/api/wireframe?project=${testProjectDir}&session=${testSession}`,
        {
          method: 'POST',
          body: JSON.stringify({ name: 'new-wireframe', content: wireframeContent }),
        }
      );

      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe('new-wireframe');

      // Verify file was created
      const filePath = join(testProjectDir, '.collab', 'sessions', testSession, 'wireframes', 'new-wireframe.wireframe.json');
      const exists = fs.existsSync(filePath);
      expect(exists).toBe(true);
    });
  });

  describe('GET /api/wireframe/:id', () => {
    it('should retrieve a wireframe by id', async () => {
      const wireframesDir = join(testProjectDir, '.collab', 'sessions', testSession, 'wireframes');
      const wireframeContent = { viewport: 'tablet', direction: 'LR', screens: [] };
      const filePath = join(wireframesDir, 'my-wireframe.wireframe.json');
      await writeFile(filePath, JSON.stringify(wireframeContent, null, 2));

      const req = new Request(
        `http://localhost/api/wireframe/my-wireframe?project=${testProjectDir}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe('my-wireframe');
      // Content is returned as a JSON string, not parsed object
      expect(JSON.parse(data.content)).toEqual(wireframeContent);
      expect(data).toHaveProperty('lastModified');
    });

    it('should return 404 for non-existent wireframe', async () => {
      const req = new Request(
        `http://localhost/api/wireframe/nonexistent?project=${testProjectDir}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/wireframe/:id', () => {
    it('should update an existing wireframe', async () => {
      const wireframesDir = join(testProjectDir, '.collab', 'sessions', testSession, 'wireframes');
      const originalContent = { viewport: 'mobile', direction: 'LR', screens: [] };
      const updatedContent = {
        viewport: 'desktop',
        direction: 'LR',
        screens: [{
          id: 'home-screen',
          type: 'screen',
          name: 'Home',
          bounds: { x: 0, y: 0, width: 375, height: 600 },
          children: []
        }]
      };

      const filePath = join(wireframesDir, 'update-test.wireframe.json');
      await writeFile(filePath, JSON.stringify(originalContent, null, 2));

      const req = new Request(
        `http://localhost/api/wireframe/update-test?project=${testProjectDir}&session=${testSession}`,
        {
          method: 'POST',
          body: JSON.stringify({ content: updatedContent }),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify file was updated
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(updatedContent);
    });

    it('should return 404 when updating non-existent wireframe', async () => {
      // Even for non-existent wireframes, validation runs first, so use a valid wireframe
      const validContent = { viewport: 'mobile', direction: 'LR', screens: [] };
      const req = new Request(
        `http://localhost/api/wireframe/nonexistent?project=${testProjectDir}&session=${testSession}`,
        {
          method: 'POST',
          body: JSON.stringify({ content: validContent }),
        }
      );
      const response = await handleAPI(req, {} as any, {} as any, {} as any, mockValidator, mockRenderer, mockWSHandler);

      expect(response.status).toBe(404);
    });
  });
});
