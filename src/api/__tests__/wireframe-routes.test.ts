import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  listWireframesHandler,
  createWireframeHandler,
  getWireframeHandler,
  updateWireframeHandler,
} from '../wireframe-routes';

describe('Wireframe Routes', () => {
  let testProjectDir: string;
  let testSessionDir: string;
  let wireframesDir: string;

  beforeEach(async () => {
    testProjectDir = join(tmpdir(), `test-wireframe-project-${Date.now()}`);
    testSessionDir = join(testProjectDir, '.collab', 'test-session');
    wireframesDir = join(testSessionDir, 'wireframes');

    await mkdir(wireframesDir, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('listWireframesHandler', () => {
    it('should return empty list when no wireframes exist', async () => {
      const req = {
        query: { project: testProjectDir, session: 'test-session' },
      } as any;
      const res = { json: (data: any) => data } as any;

      const result = await listWireframesHandler(req, res);

      expect(result.wireframes).toEqual([]);
    });

    it('should list wireframes with correct metadata', async () => {
      // Create a wireframe file
      const wireframeContent = { viewport: 'mobile', direction: 'LR', screens: [] };
      const filePath = join(wireframesDir, 'test-wireframe.wireframe.json');
      await mkdir(join(wireframesDir), { recursive: true });
      await writeFile(filePath, JSON.stringify(wireframeContent, null, 2));

      const req = {
        query: { project: testProjectDir, session: 'test-session' },
      } as any;
      const res = { json: (data: any) => data } as any;

      const result = await listWireframesHandler(req, res);

      expect(result.wireframes).toHaveLength(1);
      expect(result.wireframes[0]).toHaveProperty('id');
      expect(result.wireframes[0]).toHaveProperty('name');
      expect(result.wireframes[0].id).toBe('test-wireframe');
    });

    it('should filter for .wireframe.json files only', async () => {
      // Create different file types
      await writeFile(join(wireframesDir, 'test1.wireframe.json'), '{}');
      await writeFile(join(wireframesDir, 'test2.txt'), '{}');
      await writeFile(join(wireframesDir, 'test3.wireframe.json'), '{}');

      const req = {
        query: { project: testProjectDir, session: 'test-session' },
      } as any;
      const res = { json: (data: any) => data } as any;

      const result = await listWireframesHandler(req, res);

      expect(result.wireframes).toHaveLength(2);
      expect(result.wireframes.map((w: any) => w.id)).toContain('test1');
      expect(result.wireframes.map((w: any) => w.id)).toContain('test3');
    });
  });

  describe('createWireframeHandler', () => {
    it('should create a new wireframe file', async () => {
      const wireframeContent = { viewport: 'mobile', direction: 'LR', screens: [] };

      const req = {
        query: { project: testProjectDir, session: 'test-session' },
        json: async () => ({ name: 'my-wireframe', content: wireframeContent }),
      } as any;

      const responses: any[] = [];
      const res = {
        json: (data: any) => {
          responses.push(data);
          return data;
        },
      } as any;

      const result = await createWireframeHandler(req, res);

      expect(result.success).toBe(true);
      expect(result.id).toBe('my-wireframe');

      // Verify file was created
      const filePath = join(wireframesDir, 'my-wireframe.wireframe.json');
      const exists = fs.existsSync(filePath);
      expect(exists).toBe(true);

      // Verify content
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(wireframeContent);
    });

    it('should return id and success on creation', async () => {
      const wireframeContent = { viewport: 'desktop', screens: [] };

      const req = {
        query: { project: testProjectDir, session: 'test-session' },
        json: async () => ({ name: 'test-wf', content: wireframeContent }),
      } as any;

      const res = { json: (data: any) => data } as any;

      const result = await createWireframeHandler(req, res);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('id', 'test-wf');
    });

    it('should handle nested project paths', async () => {
      const nestedProjectDir = join(tmpdir(), `nested-${Date.now()}`, 'project');
      const nestedSessionDir = join(nestedProjectDir, '.collab', 'test-session');
      const nestedWireframesDir = join(nestedSessionDir, 'wireframes');

      const wireframeContent = { viewport: 'mobile', screens: [] };

      const req = {
        query: { project: nestedProjectDir, session: 'test-session' },
        json: async () => ({ name: 'nested-wf', content: wireframeContent }),
      } as any;

      const res = { json: (data: any) => data } as any;

      const result = await createWireframeHandler(req, res);

      expect(result.success).toBe(true);

      // Verify file was created in nested directory
      const filePath = join(nestedWireframesDir, 'nested-wf.wireframe.json');
      const exists = fs.existsSync(filePath);
      expect(exists).toBe(true);

      // Cleanup
      await rm(join(tmpdir(), `nested-${Date.now()}`), { recursive: true, force: true });
    });
  });

  describe('getWireframeHandler', () => {
    it('should retrieve a wireframe by id', async () => {
      const wireframeContent = { viewport: 'tablet', direction: 'TD', screens: [] };
      const filePath = join(wireframesDir, 'test-get.wireframe.json');
      await writeFile(filePath, JSON.stringify(wireframeContent, null, 2));

      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'test-get' },
      } as any;

      let capturedData: any = null;
      const res = {
        status: (code: number) => res,
        json: (data: any) => {
          capturedData = data;
          return data;
        }
      } as any;

      await getWireframeHandler(req, res);

      expect(capturedData.id).toBe('test-get');
      expect(capturedData.content).toEqual(wireframeContent);
    });

    it('should return 404 when wireframe not found', async () => {
      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'nonexistent' },
      } as any;

      let statusCode = 200;
      let capturedData: any = null;
      const res = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: any) => {
              capturedData = data;
              return data;
            },
          };
        },
        json: (data: any) => {
          throw new Error('Should call status first');
        },
      } as any;

      await getWireframeHandler(req, res);

      expect(statusCode).toBe(404);
      expect(capturedData).toHaveProperty('error');
    });

    it('should include lastModified timestamp', async () => {
      const wireframeContent = { viewport: 'mobile', screens: [] };
      const filePath = join(wireframesDir, 'test-timestamp.wireframe.json');
      await writeFile(filePath, JSON.stringify(wireframeContent, null, 2));

      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'test-timestamp' },
      } as any;

      let capturedData: any = null;
      const res = {
        status: (code: number) => res,
        json: (data: any) => {
          capturedData = data;
          return data;
        }
      } as any;

      await getWireframeHandler(req, res);

      expect(capturedData).toHaveProperty('lastModified');
      expect(typeof capturedData.lastModified).toBe('number');
      expect(capturedData.lastModified).toBeGreaterThan(0);
    });
  });

  describe('updateWireframeHandler', () => {
    it('should update an existing wireframe', async () => {
      const originalContent = { viewport: 'mobile', screens: [] };
      const updatedContent = { viewport: 'desktop', screens: [{ type: 'Screen', label: 'Home' }] };

      const filePath = join(wireframesDir, 'test-update.wireframe.json');
      await writeFile(filePath, JSON.stringify(originalContent, null, 2));

      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'test-update' },
        json: async () => ({ content: updatedContent }),
      } as any;

      let capturedData: any = null;
      const res = {
        status: (code: number) => res,
        json: (data: any) => {
          capturedData = data;
          return data;
        }
      } as any;

      await updateWireframeHandler(req, res);

      expect(capturedData.success).toBe(true);

      // Verify file was updated
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(updatedContent);
    });

    it('should return 404 when wireframe not found', async () => {
      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'nonexistent' },
        json: async () => ({ content: { viewport: 'mobile' } }),
      } as any;

      let statusCode = 200;
      let capturedData: any = null;
      const res = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: any) => {
              capturedData = data;
              return data;
            },
          };
        },
        json: (data: any) => {
          throw new Error('Should call status first');
        },
      } as any;

      await updateWireframeHandler(req, res);

      expect(statusCode).toBe(404);
      expect(capturedData).toHaveProperty('error');
    });

    it('should preserve file format with proper JSON indentation', async () => {
      const originalContent = { viewport: 'mobile' };
      const updatedContent = { viewport: 'tablet', screens: [{ type: 'Screen' }] };

      const filePath = join(wireframesDir, 'test-format.wireframe.json');
      await writeFile(filePath, JSON.stringify(originalContent, null, 2));

      const req = {
        query: { project: testProjectDir, session: 'test-session', id: 'test-format' },
        json: async () => ({ content: updatedContent }),
      } as any;

      const res = {
        status: (code: number) => res,
        json: (data: any) => data
      } as any;

      await updateWireframeHandler(req, res);

      const rawContent = await readFile(filePath, 'utf-8');
      // Verify proper indentation (2 spaces)
      expect(rawContent).toContain('  "viewport"');
    });
  });
});
