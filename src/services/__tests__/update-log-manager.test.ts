/**
 * UpdateLogManager Test Suite
 * Tests document update history logging and replay functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UpdateLogManager } from '../update-log-manager';
import type { UpdateLog, DocumentLogEntry, ChangeEntry } from '../../types/update-log';

describe('UpdateLogManager', () => {
  let testDir: string;
  let manager: UpdateLogManager;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `update-log-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create fresh manager instance for each test
    manager = new UpdateLogManager(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should initialize with the given base path', () => {
      const customPath = join(testDir, 'custom');
      mkdirSync(customPath, { recursive: true });
      const customManager = new UpdateLogManager(customPath);

      // Verify manager is created (we'll test its functionality in other tests)
      expect(customManager).toBeDefined();
    });
  });

  describe('logUpdate', () => {
    it('should capture original content on first update', async () => {
      const documentId = 'test-doc';
      const oldContent = 'Original content';
      const newContent = 'Updated content';

      await manager.logUpdate('documents', documentId, oldContent, newContent);

      const history = await manager.getHistory('documents', documentId);
      expect(history).not.toBeNull();
      expect(history!.original).toBe(oldContent);
    });

    it('should append change entry with timestamp and diff', async () => {
      const documentId = 'test-doc';
      const oldContent = 'Hello world';
      const newContent = 'Hello universe';

      await manager.logUpdate('documents', documentId, oldContent, newContent);

      const history = await manager.getHistory('documents', documentId);
      expect(history).not.toBeNull();
      expect(history!.changes).toHaveLength(1);
      expect(history!.changes[0].diff.oldString).toBe(oldContent);
      expect(history!.changes[0].diff.newString).toBe(newContent);
      expect(history!.changes[0].timestamp).toBeDefined();
    });

    it('should use provided diff when available', async () => {
      const documentId = 'test-doc';
      const oldContent = 'Full document content here';
      const newContent = 'Full document modified here';
      const diff = { oldString: 'content', newString: 'modified' };

      await manager.logUpdate('documents', documentId, oldContent, newContent, diff);

      const history = await manager.getHistory('documents', documentId);
      expect(history!.changes[0].diff.oldString).toBe('content');
      expect(history!.changes[0].diff.newString).toBe('modified');
    });

    it('should skip logging when content is unchanged', async () => {
      const documentId = 'test-doc';
      const content = 'Same content';

      await manager.logUpdate('documents', documentId, content, content);

      const history = await manager.getHistory('documents', documentId);
      expect(history).toBeNull();
    });

    it('should accumulate multiple changes', async () => {
      const documentId = 'test-doc';

      await manager.logUpdate('documents', documentId, 'Version 1', 'Version 2');
      await manager.logUpdate('documents', documentId, 'Version 2', 'Version 3');
      await manager.logUpdate('documents', documentId, 'Version 3', 'Version 4');

      const history = await manager.getHistory('documents', documentId);
      expect(history!.original).toBe('Version 1');
      expect(history!.changes).toHaveLength(3);
      expect(history!.changes[0].diff.newString).toBe('Version 2');
      expect(history!.changes[1].diff.newString).toBe('Version 3');
      expect(history!.changes[2].diff.newString).toBe('Version 4');
    });

    it('should handle multiple documents independently', async () => {
      await manager.logUpdate('documents', 'doc1', 'Doc 1 original', 'Doc 1 updated');
      await manager.logUpdate('documents', 'doc2', 'Doc 2 original', 'Doc 2 updated');

      const history1 = await manager.getHistory('documents', 'doc1');
      const history2 = await manager.getHistory('documents', 'doc2');

      expect(history1!.original).toBe('Doc 1 original');
      expect(history2!.original).toBe('Doc 2 original');
      expect(history1!.changes[0].diff.newString).toBe('Doc 1 updated');
      expect(history2!.changes[0].diff.newString).toBe('Doc 2 updated');
    });

    it('should handle empty strings as valid content', async () => {
      const documentId = 'test-doc';

      await manager.logUpdate('documents', documentId, '', 'Some content');

      const history = await manager.getHistory('documents', documentId);
      expect(history!.original).toBe('');
      expect(history!.changes[0].diff.newString).toBe('Some content');
    });

    it('should persist log to disk', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Old', 'New');

      // Create a new manager instance to verify persistence
      const newManager = new UpdateLogManager(testDir);
      const history = await newManager.getHistory('documents', 'test-doc');

      expect(history).not.toBeNull();
      expect(history!.original).toBe('Old');
    });

    it('should write valid JSON to disk', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Old', 'New');

      const logPath = join(testDir, 'update-log.json');
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content) as UpdateLog;

      expect(parsed.documents).toBeDefined();
      expect(parsed.documents['test-doc']).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('should return null for document with no history', async () => {
      const history = await manager.getHistory('documents', 'nonexistent-doc');
      expect(history).toBeNull();
    });

    it('should return null when log file does not exist', async () => {
      const emptyDir = join(testDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      const emptyManager = new UpdateLogManager(emptyDir);

      const history = await emptyManager.getHistory('documents', 'any-doc');
      expect(history).toBeNull();
    });

    it('should return complete history for existing document', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Original', 'Updated');

      const history = await manager.getHistory('documents', 'test-doc');

      expect(history).not.toBeNull();
      expect(history!.original).toBe('Original');
      expect(history!.changes).toHaveLength(1);
      expect(history!.changes[0].diff.oldString).toBe('Original');
      expect(history!.changes[0].diff.newString).toBe('Updated');
    });

    it('should handle corrupted JSON gracefully', async () => {
      // Write invalid JSON to the log file
      const logPath = join(testDir, 'update-log.json');
      writeFileSync(logPath, 'not valid json {{{');

      const history = await manager.getHistory('documents', 'any-doc');
      expect(history).toBeNull();
    });
  });

  describe('replayToTimestamp', () => {
    it('should throw error when no history exists', async () => {
      await expect(
        manager.replayToTimestamp('documents', 'nonexistent-doc', new Date().toISOString())
      ).rejects.toThrow('No history found for document nonexistent-doc');
    });

    it('should return original content when timestamp is before any changes', async () => {
      const beforeTimestamp = new Date(Date.now() - 10000).toISOString();
      await manager.logUpdate('documents', 'test-doc', 'Original', 'Updated');

      const content = await manager.replayToTimestamp('documents', 'test-doc', beforeTimestamp);
      expect(content).toBe('Original');
    });

    it('should return fully replayed content when timestamp is after all changes', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Version 1', 'Version 2');
      await manager.logUpdate('documents', 'test-doc', 'Version 2', 'Version 3');

      const futureTimestamp = new Date(Date.now() + 10000).toISOString();
      const content = await manager.replayToTimestamp('documents', 'test-doc', futureTimestamp);
      expect(content).toBe('Version 3');
    });

    it('should replay changes up to specific timestamp', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Version 1', 'Version 2');

      // Wait a bit and record timestamp
      await new Promise(resolve => setTimeout(resolve, 50));
      const midTimestamp = new Date().toISOString();
      await new Promise(resolve => setTimeout(resolve, 50));

      await manager.logUpdate('documents', 'test-doc', 'Version 2', 'Version 3');

      const content = await manager.replayToTimestamp('documents', 'test-doc', midTimestamp);
      expect(content).toBe('Version 2');
    });

    it('should include change at exact timestamp match', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Version 1', 'Version 2');

      const history = await manager.getHistory('documents', 'test-doc');
      const exactTimestamp = history!.changes[0].timestamp;

      const content = await manager.replayToTimestamp('documents', 'test-doc', exactTimestamp);
      expect(content).toBe('Version 2');
    });

    it('should handle patch-style diffs correctly', async () => {
      const original = 'Hello world, this is a test document.';
      const updated = 'Hello universe, this is a test document.';
      const diff = { oldString: 'world', newString: 'universe' };

      await manager.logUpdate('documents', 'test-doc', original, updated, diff);

      const futureTimestamp = new Date(Date.now() + 10000).toISOString();
      const content = await manager.replayToTimestamp('documents', 'test-doc', futureTimestamp);

      // When using patch-style diff, replay applies oldString->newString replacement
      expect(content).toBe('Hello universe, this is a test document.');
    });

    it('should handle multiple patch diffs sequentially', async () => {
      const original = 'The quick brown fox jumps over the lazy dog.';

      await manager.logUpdate(
        'documents',
        'test-doc',
        original,
        'The quick brown cat jumps over the lazy dog.',
        { oldString: 'fox', newString: 'cat' }
      );

      await manager.logUpdate(
        'documents',
        'test-doc',
        'The quick brown cat jumps over the lazy dog.',
        'The quick brown cat jumps over the lazy cat.',
        { oldString: 'dog', newString: 'cat' }
      );

      const futureTimestamp = new Date(Date.now() + 10000).toISOString();
      const content = await manager.replayToTimestamp('documents', 'test-doc', futureTimestamp);
      expect(content).toBe('The quick brown cat jumps over the lazy cat.');
    });
  });

  describe('loadLog (private, tested via public methods)', () => {
    it('should return empty log when file does not exist', async () => {
      const emptyDir = join(testDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      const emptyManager = new UpdateLogManager(emptyDir);

      // Calling getHistory exercises loadLog
      const history = await emptyManager.getHistory('documents', 'any-doc');
      expect(history).toBeNull();
    });

    it('should recover gracefully from corrupted log file', async () => {
      // Write corrupted JSON
      writeFileSync(join(testDir, 'update-log.json'), '{ invalid json');

      // Should not throw, should return null for history
      const history = await manager.getHistory('documents', 'any-doc');
      expect(history).toBeNull();
    });
  });

  describe('saveLog (private, tested via public methods)', () => {
    it('should save log atomically (via temp file)', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Old', 'New');

      // Verify the log file exists and temp file doesn't
      const logPath = join(testDir, 'update-log.json');
      const tempPath = join(testDir, 'update-log.json.tmp');

      expect(existsSync(logPath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
    });

    it('should write formatted JSON with indentation', async () => {
      await manager.logUpdate('documents', 'test-doc', 'Old', 'New');

      const logPath = join(testDir, 'update-log.json');
      const content = readFileSync(logPath, 'utf-8');

      // Should be formatted with newlines/indentation
      expect(content).toContain('\n');
    });
  });

  describe('error handling', () => {
    it('should throw descriptive error when save fails', async () => {
      // Create a read-only directory scenario by using an invalid path
      const invalidManager = new UpdateLogManager('/nonexistent/path/that/does/not/exist');

      await expect(
        invalidManager.logUpdate('documents', 'test-doc', 'Old', 'New')
      ).rejects.toThrow('Failed to save update log');
    });
  });
});
