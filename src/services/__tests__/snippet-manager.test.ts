import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnippetManager } from '../snippet-manager';
import { mkdir, rm, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';

describe('SnippetManager', () => {
  let tempDir: string;
  let manager: SnippetManager;

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = `/tmp/snippet-manager-test-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });
    manager = new SnippetManager(tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Failed to clean up temp directory:', error);
    }
  });

  describe('initialize', () => {
    it('should create the base directory', async () => {
      await manager.initialize();
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    it('should create the history directory', async () => {
      await manager.initialize();
      const historyPath = join(tempDir, '.history');
      expect(fs.existsSync(historyPath)).toBe(true);
    });

    it('should index existing snippets', async () => {
      // Create some snippet files manually
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, 'test1.snippet'), 'content1');
      await writeFile(join(tempDir, 'test2.snippet'), 'content2');

      await manager.initialize();

      expect(manager.getIndexSize()).toBe(2);
      expect(manager.hasSnippet('test1')).toBe(true);
      expect(manager.hasSnippet('test2')).toBe(true);
    });
  });

  describe('createSnippet', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should create a new snippet with valid content', async () => {
      const id = await manager.createSnippet('test-snippet', 'console.log("hello")');
      expect(id).toBe('test-snippet');
      expect(manager.hasSnippet('test-snippet')).toBe(true);
    });

    it('should sanitize snippet names', async () => {
      const id = await manager.createSnippet('Test Snippet!@#$', 'content');
      expect(id).toBe('Test-Snippet');
    });

    it('should throw error for duplicate snippet names', async () => {
      await manager.createSnippet('duplicate', 'content1');

      try {
        await manager.createSnippet('duplicate', 'content2');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('already exists');
      }
    });

    it('should throw error for empty name', async () => {
      try {
        await manager.createSnippet('', 'content');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('non-empty string');
      }
    });

    it('should throw error for undefined content', async () => {
      try {
        await manager.createSnippet('test', undefined as any);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('required');
      }
    });

    it('should throw error for oversized content', async () => {
      const largeContent = 'x'.repeat(1048577); // 1MB + 1 byte
      try {
        await manager.createSnippet('large', largeContent);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('too large');
      }
    });

    it('should create version history on creation', async () => {
      await manager.createSnippet('versioned', 'initial content');
      const history = await manager.getHistory('versioned');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].content).toBe('initial content');
    });
  });

  describe('getSnippet', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.createSnippet('existing', 'test content');
    });

    it('should retrieve an existing snippet', async () => {
      const snippet = await manager.getSnippet('existing');
      expect(snippet).not.toBeNull();
      expect(snippet?.id).toBe('existing');
      expect(snippet?.content).toBe('test content');
    });

    it('should return null for non-existent snippet', async () => {
      const snippet = await manager.getSnippet('nonexistent');
      expect(snippet).toBeNull();
    });

    it('should return correct metadata', async () => {
      const snippet = await manager.getSnippet('existing');
      expect(snippet?.lastModified).toBeGreaterThan(0);
      expect(snippet?.name).toBe('existing');
    });
  });

  describe('saveSnippet', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.createSnippet('editable', 'original content');
    });

    it('should update snippet content', async () => {
      await manager.saveSnippet('editable', 'updated content');
      const snippet = await manager.getSnippet('editable');
      expect(snippet?.content).toBe('updated content');
    });

    it('should throw error for non-existent snippet', async () => {
      try {
        await manager.saveSnippet('nonexistent', 'content');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('not found');
      }
    });

    it('should throw error for oversized content', async () => {
      const largeContent = 'x'.repeat(1048577);
      try {
        await manager.saveSnippet('editable', largeContent);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('too large');
      }
    });

    it('should update lastModified timestamp', async () => {
      const before = await manager.getSnippet('editable');
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.saveSnippet('editable', 'new content');
      const after = await manager.getSnippet('editable');
      expect(after!.lastModified).toBeGreaterThanOrEqual(before!.lastModified);
    });

    it('should record version history on save', async () => {
      const historyBefore = await manager.getHistory('editable');
      await manager.saveSnippet('editable', 'second version');
      const historyAfter = await manager.getHistory('editable');
      expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
    });
  });

  describe('deleteSnippet', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.createSnippet('doomed', 'content to be deleted');
    });

    it('should delete an existing snippet', async () => {
      await manager.deleteSnippet('doomed');
      expect(manager.hasSnippet('doomed')).toBe(false);
    });

    it('should remove from index', async () => {
      const sizeBefore = manager.getIndexSize();
      await manager.deleteSnippet('doomed');
      const sizeAfter = manager.getIndexSize();
      expect(sizeAfter).toBe(sizeBefore - 1);
    });

    it('should throw error for non-existent snippet', async () => {
      try {
        await manager.deleteSnippet('nonexistent');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('not found');
      }
    });

    it('should remove history file', async () => {
      const historyPath = join(tempDir, '.history', 'doomed.history');
      expect(fs.existsSync(historyPath)).toBe(true);
      await manager.deleteSnippet('doomed');
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for async cleanup
      expect(fs.existsSync(historyPath)).toBe(false);
    });
  });

  describe('listSnippets', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.createSnippet('first', 'content1');
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.createSnippet('second', 'content2');
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.createSnippet('third', 'content3');
    });

    it('should list all snippets', async () => {
      const snippets = await manager.listSnippets();
      expect(snippets.length).toBe(3);
    });

    it('should return correct snippet metadata', async () => {
      const snippets = await manager.listSnippets();
      const ids = snippets.map(s => s.id);
      expect(ids).toContain('first');
      expect(ids).toContain('second');
      expect(ids).toContain('third');
    });

    it('should sort by lastModified descending', async () => {
      const snippets = await manager.listSnippets();
      for (let i = 0; i < snippets.length - 1; i++) {
        expect(snippets[i].lastModified).toBeGreaterThanOrEqual(snippets[i + 1].lastModified);
      }
    });
  });

  describe('Version History', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.createSnippet('versioned', 'v1');
    });

    it('should maintain version history', async () => {
      await manager.saveSnippet('versioned', 'v2');
      await manager.saveSnippet('versioned', 'v3');

      const history = await manager.getHistory('versioned');
      expect(history.length).toBeGreaterThanOrEqual(3);
    });

    it('should retrieve version at timestamp', async () => {
      await manager.saveSnippet('versioned', 'v2');
      const timestamp = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.saveSnippet('versioned', 'v3');

      const version = await manager.getVersionAtTimestamp('versioned', timestamp);
      expect(version).toBe('v2');
    });

    it('should preserve all version contents', async () => {
      const contents = ['v1', 'v2', 'v3', 'v4'];
      for (let i = 1; i < contents.length; i++) {
        await manager.saveSnippet('versioned', contents[i]);
      }

      const history = await manager.getHistory('versioned');
      const historyContents = history.map(e => e.content);
      for (const content of contents) {
        expect(historyContents).toContain(content);
      }
    });

    it('should throw error for history of non-existent snippet', async () => {
      try {
        await manager.getHistory('nonexistent');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('not found');
      }
    });
  });

  describe('index management', () => {
    it('should update index entry', async () => {
      await manager.initialize();
      const path = join(tempDir, 'test.snippet');
      await writeFile(path, 'content');

      manager.updateIndex('test', path);

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(manager.hasSnippet('test')).toBe(true);
    });

    it('should remove from index', async () => {
      await manager.initialize();
      await manager.createSnippet('removable', 'content');
      expect(manager.hasSnippet('removable')).toBe(true);

      manager.removeFromIndex('removable');
      expect(manager.hasSnippet('removable')).toBe(false);
    });

    it('should reset index', async () => {
      await manager.initialize();
      await manager.createSnippet('snippet1', 'content1');
      await manager.createSnippet('snippet2', 'content2');

      expect(manager.getIndexSize()).toBe(2);

      manager.reset();

      expect(manager.getIndexSize()).toBe(0);
    });

    it('should return correct index size', async () => {
      await manager.initialize();
      expect(manager.getIndexSize()).toBe(0);

      await manager.createSnippet('s1', 'c1');
      expect(manager.getIndexSize()).toBe(1);

      await manager.createSnippet('s2', 'c2');
      expect(manager.getIndexSize()).toBe(2);

      await manager.deleteSnippet('s1');
      expect(manager.getIndexSize()).toBe(1);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should handle corrupted history gracefully', async () => {
      await manager.createSnippet('corrupted', 'initial');

      // Corrupt the history file
      const historyPath = join(tempDir, '.history', 'corrupted.history');
      await writeFile(historyPath, 'invalid json {]');

      // Should not throw when reading corrupted history
      const snippet = await manager.getSnippet('corrupted');
      expect(snippet).not.toBeNull();
    });

    it('should handle missing snippet file gracefully', async () => {
      await manager.createSnippet('missing', 'content');

      // Delete the snippet file but keep it in index
      const snippetPath = join(tempDir, 'missing.snippet');
      await unlink(snippetPath);

      // Should return null instead of throwing
      const snippet = await manager.getSnippet('missing');
      expect(snippet).toBeNull();
    });
  });
});
