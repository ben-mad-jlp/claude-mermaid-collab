/**
 * Type tests for update-log types
 * These tests verify type correctness at compile time
 */

import { describe, it, expect } from 'bun:test';
import type {
  ChangeEntry,
  DocumentLogEntry,
  UpdateLog,
  HistoryResponse,
  VersionResponse,
} from './update-log';

describe('update-log types', () => {
  describe('ChangeEntry', () => {
    it('should have correct structure', () => {
      const entry: ChangeEntry = {
        timestamp: '2024-01-01T00:00:00Z',
        diff: {
          oldString: 'original text',
          newString: 'updated text',
        },
      };

      expect(entry.timestamp).toBe('2024-01-01T00:00:00Z');
      expect(entry.diff.oldString).toBe('original text');
      expect(entry.diff.newString).toBe('updated text');
    });
  });

  describe('DocumentLogEntry', () => {
    it('should have correct structure', () => {
      const logEntry: DocumentLogEntry = {
        original: '# My Document\n\nInitial content',
        changes: [
          {
            timestamp: '2024-01-01T00:00:00Z',
            diff: {
              oldString: 'Initial content',
              newString: 'Updated content',
            },
          },
        ],
      };

      expect(logEntry.original).toContain('Initial content');
      expect(logEntry.changes).toHaveLength(1);
      expect(logEntry.changes[0].diff.newString).toBe('Updated content');
    });

    it('should allow empty changes array', () => {
      const logEntry: DocumentLogEntry = {
        original: 'Some content',
        changes: [],
      };

      expect(logEntry.changes).toHaveLength(0);
    });
  });

  describe('UpdateLog', () => {
    it('should have correct structure', () => {
      const updateLog: UpdateLog = {
        documents: {
          'doc-1': {
            original: 'Document 1 content',
            changes: [],
          },
          'doc-2': {
            original: 'Document 2 content',
            changes: [
              {
                timestamp: '2024-01-01T00:00:00Z',
                diff: {
                  oldString: 'old',
                  newString: 'new',
                },
              },
            ],
          },
        },
      };

      expect(Object.keys(updateLog.documents)).toHaveLength(2);
      expect(updateLog.documents['doc-1'].original).toBe('Document 1 content');
      expect(updateLog.documents['doc-2'].changes).toHaveLength(1);
    });

    it('should allow empty documents', () => {
      const updateLog: UpdateLog = {
        documents: {},
      };

      expect(Object.keys(updateLog.documents)).toHaveLength(0);
    });
  });

  describe('HistoryResponse', () => {
    it('should have correct structure', () => {
      const response: HistoryResponse = {
        id: 'doc-123',
        original: 'Original content',
        changes: [
          {
            timestamp: '2024-01-01T00:00:00Z',
            diff: {
              oldString: 'Original content',
              newString: 'Modified content',
            },
          },
        ],
      };

      expect(response.id).toBe('doc-123');
      expect(response.original).toBe('Original content');
      expect(response.changes).toHaveLength(1);
    });
  });

  describe('VersionResponse', () => {
    it('should have correct structure', () => {
      const response: VersionResponse = {
        id: 'doc-123',
        content: 'Content at version 2',
        timestamp: '2024-01-02T00:00:00Z',
        version: 2,
      };

      expect(response.id).toBe('doc-123');
      expect(response.content).toBe('Content at version 2');
      expect(response.timestamp).toBe('2024-01-02T00:00:00Z');
      expect(response.version).toBe(2);
    });

    it('should allow version 0 for original', () => {
      const response: VersionResponse = {
        id: 'doc-123',
        content: 'Original content',
        timestamp: '2024-01-01T00:00:00Z',
        version: 0,
      };

      expect(response.version).toBe(0);
    });
  });
});
