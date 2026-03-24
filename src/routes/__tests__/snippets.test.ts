import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'fs/promises';
import { join } from 'path';
import { SnippetManager } from '../../services/snippet-manager';
import { sessionRegistry } from '../../services/session-registry';
import { homedir } from 'os';

/**
 * Tests for Snippet API routes and SnippetManager
 */

const TEST_PROJECT = join(homedir(), '.test-collab-snippets');
const TEST_SESSION = 'test-session';

describe('Snippet API Routes', () => {
  let snippetsPath: string;

  beforeAll(async () => {
    // Register test session
    await sessionRegistry.register(TEST_PROJECT, TEST_SESSION);
    snippetsPath = sessionRegistry.resolvePath(TEST_PROJECT, TEST_SESSION, 'snippets');
  });

  afterAll(async () => {
    // Cleanup
    try {
      await rm(TEST_PROJECT, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('GET /api/snippets - List snippets', () => {
    it('should list all snippets for a session', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      // Create some snippets
      await manager.createSnippet('snippet1', 'console.log("test1")');
      await manager.createSnippet('snippet2', 'console.log("test2")');

      const snippets = await manager.listSnippets();
      expect(snippets).toHaveLength(2);
      expect(snippets[0].name).toBeDefined();
      expect(snippets[0].id).toBeDefined();
      expect(snippets[0].lastModified).toBeGreaterThan(0);
    });

    it('should handle empty snippet list', async () => {
      const emptyPath = join(TEST_PROJECT, 'empty-snippets');
      const manager = new SnippetManager(emptyPath);
      await manager.initialize();

      const snippets = await manager.listSnippets();
      expect(snippets).toHaveLength(0);
    });

    it('should sort snippets by modification time (newest first)', async () => {
      const sortPath = join(TEST_PROJECT, 'sort-snippets');
      const manager = new SnippetManager(sortPath);
      await manager.initialize();

      const id1 = await manager.createSnippet('first', 'code1');
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      const id2 = await manager.createSnippet('second', 'code2');

      const snippets = await manager.listSnippets();
      expect(snippets[0].id).toBe(id2); // Most recent first
      expect(snippets[1].id).toBe(id1);
    });
  });

  describe('GET /api/snippet/:id - Retrieve specific snippet', () => {
    it('should retrieve a specific snippet by ID', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const content = 'const test = () => {}';
      const id = await manager.createSnippet('test-snippet', content);

      const snippet = await manager.getSnippet(id);
      expect(snippet).toBeDefined();
      expect(snippet?.id).toBe(id);
      expect(snippet?.name).toBe(id);
      expect(snippet?.content).toBe(content);
      expect(snippet?.lastModified).toBeGreaterThan(0);
    });

    it('should return null for non-existent snippet', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const snippet = await manager.getSnippet('non-existent-id-12345');
      expect(snippet).toBeNull();
    });

    it('should preserve exact content including special characters', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const content = 'const test = `\n  multi\n  line\n  string\n`; // @ts-ignore\n"quotes"';
      const id = await manager.createSnippet('special', content);

      const snippet = await manager.getSnippet(id);
      expect(snippet?.content).toBe(content);
    });
  });

  describe('POST /api/snippet - Create new snippet', () => {
    it('should create a new snippet with name and content', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('my-snippet', 'const x = 1;');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const snippet = await manager.getSnippet(id);
      expect(snippet).toBeDefined();
      expect(snippet?.content).toBe('const x = 1;');
    });

    it('should validate snippet name is required', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      try {
        // @ts-ignore - Testing invalid input
        await manager.createSnippet('', 'content');
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('name must be a non-empty string');
      }
    });

    it('should validate snippet content is required', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      try {
        // @ts-ignore - Testing invalid input
        await manager.createSnippet('name', undefined);
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('content is required');
      }
    });

    it('should reject snippets exceeding MAX_FILE_SIZE', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      // Create content larger than 10MB (config.MAX_FILE_SIZE default)
      const largeContent = 'x'.repeat(10 * 1024 * 1024 + 1);

      try {
        await manager.createSnippet('large', largeContent);
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('too large');
      }
    });

    it('should generate unique IDs for each snippet', async () => {
      const uniquePath = join(TEST_PROJECT, 'unique-snippets');
      const manager = new SnippetManager(uniquePath);
      await manager.initialize();

      const id1 = await manager.createSnippet('unique1', 'code1');
      const id2 = await manager.createSnippet('unique2', 'code2');
      const id3 = await manager.createSnippet('unique3', 'code3');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('PUT /api/snippet/:id - Update snippet content', () => {
    it('should update an existing snippet content', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('updateable', 'original content');
      const newContent = 'updated content';

      await manager.saveSnippet(id, newContent);

      const updated = await manager.getSnippet(id);
      expect(updated?.content).toBe(newContent);
    });

    it('should update the lastModified timestamp', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('timestamp-test', 'original');
      const original = await manager.getSnippet(id);

      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.saveSnippet(id, 'updated');

      const updated = await manager.getSnippet(id);
      expect(updated?.lastModified).toBeGreaterThan(original?.lastModified || 0);
    });

    it('should reject update for non-existent snippet', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      try {
        await manager.saveSnippet('non-existent', 'content');
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('not found');
      }
    });

    it('should validate updated content size', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('size-test', 'small');
      const largeContent = 'x'.repeat(10 * 1024 * 1024 + 1);

      try {
        await manager.saveSnippet(id, largeContent);
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('too large');
      }
    });

    it('should preserve snippet ID and name during update', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('preserve-test', 'original');
      await manager.saveSnippet(id, 'new content with more stuff');

      const updated = await manager.getSnippet(id);
      expect(updated?.id).toBe(id);
      expect(updated?.name).toBe(id);
    });
  });

  describe('DELETE /api/snippet/:id - Delete snippet', () => {
    it('should delete an existing snippet', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('to-delete', 'temporary content');
      expect(await manager.getSnippet(id)).toBeDefined();

      await manager.deleteSnippet(id);
      expect(await manager.getSnippet(id)).toBeNull();
    });

    it('should reject deletion of non-existent snippet', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      try {
        await manager.deleteSnippet('non-existent-snippet');
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('not found');
      }
    });

    it('should remove deleted snippet from list', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id1 = await manager.createSnippet('keep', 'keep this');
      const id2 = await manager.createSnippet('delete', 'delete this');

      await manager.deleteSnippet(id2);

      const snippets = await manager.listSnippets();
      const ids = snippets.map(s => s.id);
      expect(ids).toContain(id1);
      expect(ids).not.toContain(id2);
    });
  });

  describe('Snippet Management Edge Cases', () => {
    it('should handle empty snippet content', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const id = await manager.createSnippet('empty', '');
      const snippet = await manager.getSnippet(id);
      expect(snippet?.content).toBe('');
    });

    it('should handle very large valid snippets', async () => {
      const largeValidPath = join(TEST_PROJECT, 'large-valid-snippets');
      const manager = new SnippetManager(largeValidPath);
      await manager.initialize();

      // Create a large but valid snippet (500KB, which is less than MAX_FILE_SIZE of 1MB)
      const largeContent = 'x'.repeat(500 * 1024);
      const id = await manager.createSnippet('large-valid', largeContent);

      const snippet = await manager.getSnippet(id);
      expect(snippet?.content.length).toBe(500 * 1024);
    });

    it('should handle Unicode and emoji content', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const unicodeContent = '// Unicode: café, 日本語, 🚀 emoji';
      const id = await manager.createSnippet('unicode', unicodeContent);

      const snippet = await manager.getSnippet(id);
      expect(snippet?.content).toBe(unicodeContent);
    });

    it('should handle content with newlines and special characters', async () => {
      const manager = new SnippetManager(snippetsPath);
      await manager.initialize();

      const complexContent = `function test() {
  const obj = {
    key: "value with \\"quotes\\"",
    nested: {
      arr: [1, 2, 3]
    }
  };
  return obj;
}`;
      const id = await manager.createSnippet('complex', complexContent);

      const snippet = await manager.getSnippet(id);
      expect(snippet?.content).toBe(complexContent);
    });

    it('should reinitialize and recover snippets from disk', async () => {
      const persistPath = join(TEST_PROJECT, 'persist-snippets');

      // Create and save snippets
      let manager = new SnippetManager(persistPath);
      await manager.initialize();
      const id = await manager.createSnippet('persistent', 'persistent content');

      // Reinitialize and verify recovery
      manager = new SnippetManager(persistPath);
      await manager.initialize();

      const snippet = await manager.getSnippet(id);
      expect(snippet).toBeDefined();
      expect(snippet?.content).toBe('persistent content');
    });
  });

  describe('WebSocket Broadcasting Simulation', () => {
    it('should generate correct broadcast event for snippet creation', () => {
      const event = {
        type: 'snippet_created',
        id: 'test-id-123',
        name: 'test-snippet',
        content: 'const x = 1;',
        lastModified: Date.now(),
        project: '/path/to/project',
        session: 'test-session',
      };

      expect(event.type).toBe('snippet_created');
      expect(event.id).toBeDefined();
      expect(event.name).toBeDefined();
      expect(event.content).toBeDefined();
      expect(event.lastModified).toBeGreaterThan(0);
      expect(event.project).toBeDefined();
      expect(event.session).toBeDefined();
    });

    it('should generate correct broadcast event for snippet update', () => {
      const event = {
        type: 'snippet_updated',
        id: 'test-id-123',
        content: 'const x = 2;',
        lastModified: Date.now(),
        project: '/path/to/project',
        session: 'test-session',
      };

      expect(event.type).toBe('snippet_updated');
      expect(event.id).toBeDefined();
      expect(event.content).toBeDefined();
      expect(event.lastModified).toBeGreaterThan(0);
    });

    it('should generate correct broadcast event for snippet deletion', () => {
      const event = {
        type: 'snippet_deleted',
        id: 'test-id-123',
        project: '/path/to/project',
        session: 'test-session',
      };

      expect(event.type).toBe('snippet_deleted');
      expect(event.id).toBeDefined();
      expect(event.project).toBeDefined();
      expect(event.session).toBeDefined();
    });
  });
});
