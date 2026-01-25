import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KodexManager, TopicContent, FlagStatus } from '../kodex-manager';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('KodexManager.approveDraft()', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-${Date.now()}`);
    mkdirSync(testProjectPath, { recursive: true });
    manager = new KodexManager(testProjectPath);
  });

  afterEach(() => {
    manager.close();
    try {
      rmSync(testProjectPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('auto-resolving flags', () => {
    it('should resolve all open flags when draft is approved', async () => {
      // Create a topic with a draft
      const topicName = 'test-topic';
      const title = 'Test Topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, title, content, 'test-user');

      // Create some flags for this topic
      const flag1 = await manager.createFlag(topicName, 'outdated', 'Content is outdated');
      const flag2 = await manager.createFlag(topicName, 'incomplete', 'Missing details');
      const flag3 = await manager.createFlag(topicName, 'incorrect', 'Factually wrong');

      // Verify flags are open initially
      const flagsBefore = await manager.listFlags('open');
      expect(flagsBefore.length).toBeGreaterThanOrEqual(3);
      expect(flagsBefore.some(f => f.id === flag1.id && f.status === 'open')).toBe(true);
      expect(flagsBefore.some(f => f.id === flag2.id && f.status === 'open')).toBe(true);
      expect(flagsBefore.some(f => f.id === flag3.id && f.status === 'open')).toBe(true);

      // Approve the draft
      await manager.approveDraft(topicName);

      // Verify flags are now resolved
      const flagsAfter = await manager.listFlags();
      const flag1After = flagsAfter.find(f => f.id === flag1.id);
      const flag2After = flagsAfter.find(f => f.id === flag2.id);
      const flag3After = flagsAfter.find(f => f.id === flag3.id);

      expect(flag1After?.status).toBe('resolved');
      expect(flag2After?.status).toBe('resolved');
      expect(flag3After?.status).toBe('resolved');

      // Verify resolved timestamps are set
      expect(flag1After?.resolvedAt).not.toBeNull();
      expect(flag2After?.resolvedAt).not.toBeNull();
      expect(flag3After?.resolvedAt).not.toBeNull();
    });

    it('should not affect flags from other topics', async () => {
      // Create two topics
      const topic1 = 'topic-one';
      const topic2 = 'topic-two';
      const title = 'Test Topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topic1, title, content, 'test-user');
      await manager.createTopic(topic2, title, content, 'test-user');

      // Create flags for both topics
      const flag1 = await manager.createFlag(topic1, 'outdated', 'Topic 1 is outdated');
      const flag2 = await manager.createFlag(topic2, 'incorrect', 'Topic 2 is incorrect');

      // Approve draft for topic 1
      await manager.approveDraft(topic1);

      // Verify only topic1 flags are resolved
      const flagsAfter = await manager.listFlags();
      const flag1After = flagsAfter.find(f => f.id === flag1.id);
      const flag2After = flagsAfter.find(f => f.id === flag2.id);

      expect(flag1After?.status).toBe('resolved');
      expect(flag2After?.status).toBe('open');
    });

    it('should gracefully handle topics with no flags', async () => {
      // Create a topic with no flags
      const topicName = 'no-flags-topic';
      const title = 'Topic with No Flags';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, title, content, 'test-user');

      // Approve draft should not throw error
      const result = await manager.approveDraft(topicName);

      // Verify topic is returned successfully
      expect(result.name).toBe(topicName);
      expect(result.hasDraft).toBe(false);
    });

    it('should not resolve already resolved flags', async () => {
      // Create a topic with a draft
      const topicName = 'mixed-flags-topic';
      const title = 'Test Topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, title, content, 'test-user');

      // Create an open flag
      const openFlag = await manager.createFlag(topicName, 'outdated', 'This is open');

      // Create and immediately resolve another flag
      const resolvedFlag = await manager.createFlag(topicName, 'incomplete', 'This will be resolved');
      await manager.updateFlagStatus(resolvedFlag.id, 'resolved');

      // Approve the draft
      await manager.approveDraft(topicName);

      // Verify only open flag was resolved
      const flagsAfter = await manager.listFlags();
      const openFlagAfter = flagsAfter.find(f => f.id === openFlag.id);
      const resolvedFlagAfter = flagsAfter.find(f => f.id === resolvedFlag.id);

      expect(openFlagAfter?.status).toBe('resolved');
      expect(resolvedFlagAfter?.status).toBe('resolved');
      // The resolved flag's timestamp should not change (it should be earlier than the approval time)
      expect(resolvedFlagAfter?.resolvedAt).not.toBeNull();
    });
  });
});
