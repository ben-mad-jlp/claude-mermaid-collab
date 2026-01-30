/**
 * Tests for Session Lessons Tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { addLesson, listLessons } from './lessons';
import { join } from 'path';
import { rm, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';

describe('lessons tools', () => {
  const testDir = join(tmpdir(), 'lessons-test-' + Date.now());
  const testSession = 'test-session';
  const sessionsDir = join(testDir, '.collab', 'sessions', testSession, 'documents');

  beforeEach(async () => {
    await mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('addLesson', () => {
    it('creates LESSONS.md if it does not exist', async () => {
      const result = await addLesson(testDir, testSession, 'Test lesson content', 'universal');

      expect(result.success).toBe(true);
      expect(result.lessonCount).toBe(1);

      const content = await readFile(join(sessionsDir, 'LESSONS.md'), 'utf-8');
      expect(content).toContain('# Session Lessons');
      expect(content).toContain('[universal]');
      expect(content).toContain('Test lesson content');
    });

    it('appends lessons to existing file', async () => {
      await addLesson(testDir, testSession, 'First lesson', 'codebase');
      const result = await addLesson(testDir, testSession, 'Second lesson', 'gotcha');

      expect(result.lessonCount).toBe(2);

      const content = await readFile(join(sessionsDir, 'LESSONS.md'), 'utf-8');
      expect(content).toContain('[codebase]');
      expect(content).toContain('First lesson');
      expect(content).toContain('[gotcha]');
      expect(content).toContain('Second lesson');
    });

    it('defaults category to universal', async () => {
      await addLesson(testDir, testSession, 'Lesson without category');

      const content = await readFile(join(sessionsDir, 'LESSONS.md'), 'utf-8');
      expect(content).toContain('[universal]');
    });

    it('supports all category types', async () => {
      await addLesson(testDir, testSession, 'L1', 'universal');
      await addLesson(testDir, testSession, 'L2', 'codebase');
      await addLesson(testDir, testSession, 'L3', 'workflow');
      await addLesson(testDir, testSession, 'L4', 'gotcha');

      const content = await readFile(join(sessionsDir, 'LESSONS.md'), 'utf-8');
      expect(content).toContain('[universal]');
      expect(content).toContain('[codebase]');
      expect(content).toContain('[workflow]');
      expect(content).toContain('[gotcha]');
    });
  });

  describe('listLessons', () => {
    it('returns empty array when no lessons exist', async () => {
      const result = await listLessons(testDir, testSession);

      expect(result.lessons).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('returns all lessons from file', async () => {
      await addLesson(testDir, testSession, 'First lesson', 'universal');
      await addLesson(testDir, testSession, 'Second lesson', 'codebase');

      const result = await listLessons(testDir, testSession);

      expect(result.count).toBe(2);
      expect(result.lessons).toHaveLength(2);
      expect(result.lessons[0].content).toBe('First lesson');
      expect(result.lessons[0].category).toBe('universal');
      expect(result.lessons[1].content).toBe('Second lesson');
      expect(result.lessons[1].category).toBe('codebase');
    });

    it('parses timestamps correctly', async () => {
      await addLesson(testDir, testSession, 'Test lesson', 'workflow');

      const result = await listLessons(testDir, testSession);

      expect(result.lessons[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });
});
