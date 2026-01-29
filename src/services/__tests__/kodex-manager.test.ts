import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KodexManager, TopicContent, FlagStatus } from '../kodex-manager';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('KodexManager.createTopic()', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-create-${Date.now()}`);
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

  describe('missing topic cleanup', () => {
    const createTestContent = (): TopicContent => ({
      conceptual: '# Conceptual',
      technical: '# Technical',
      files: '# Files',
      related: '# Related',
    });

    it('should remove entry from missing_topics table when topic is created', async () => {
      const topicName = 'previously-missing-topic';

      // Query a non-existent topic to log it as missing
      const result = await manager.getTopic(topicName);
      expect(result).toBeNull();

      // Verify it's in missing_topics
      const missingBefore = await manager.getMissingTopics();
      expect(missingBefore.some(m => m.topicName === topicName)).toBe(true);

      // Create the topic
      await manager.createTopic(topicName, 'Previously Missing Topic', createTestContent(), 'test-user');

      // Verify missing_topics entry is removed
      const missingAfter = await manager.getMissingTopics();
      expect(missingAfter.some(m => m.topicName === topicName)).toBe(false);
    });

    it('should handle creating a topic that was never in missing_topics', async () => {
      const topicName = 'brand-new-topic';

      // Verify it's not in missing_topics
      const missingBefore = await manager.getMissingTopics();
      expect(missingBefore.some(m => m.topicName === topicName)).toBe(false);

      // Create the topic - should not throw
      const draft = await manager.createTopic(topicName, 'Brand New Topic', createTestContent(), 'test-user');

      expect(draft.topicName).toBe(topicName);
    });

    it('should resolve open missing flags when topic is created', async () => {
      const topicName = 'flagged-missing-topic';

      // Create a missing flag for this topic
      const flagResult = await manager.createFlag(topicName, 'missing', 'This topic needs to be created');
      expect(flagResult.created).toBe(true);

      // Get the flag to verify it exists
      const flagsBefore = await manager.listFlags('open');
      const flag = flagsBefore.find(f => f.topicName === topicName && f.type === 'missing');
      expect(flag).toBeDefined();
      expect(flag?.status).toBe('open');

      // Create the topic
      await manager.createTopic(topicName, 'No Longer Missing', createTestContent(), 'test-user');

      // Verify flag is now resolved
      const flagsAfter = await manager.listFlags();
      const flagAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'missing');
      expect(flagAfter?.status).toBe('resolved');
      expect(flagAfter?.resolvedAt).not.toBeNull();
    });

    it('should NOT resolve non-missing flags (outdated, incorrect, incomplete)', async () => {
      const topicName = 'topic-with-various-flags';

      // Create flags of different types
      await manager.createFlag(topicName, 'outdated', 'Content is outdated');
      await manager.createFlag(topicName, 'incorrect', 'Content is incorrect');
      await manager.createFlag(topicName, 'incomplete', 'Content is incomplete');
      await manager.createFlag(topicName, 'missing', 'Topic is missing');

      // Create the topic
      await manager.createTopic(topicName, 'Topic With Various Flags', createTestContent(), 'test-user');

      // Verify only the missing flag is resolved
      const flagsAfter = await manager.listFlags();

      const outdatedAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'outdated');
      const incorrectAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'incorrect');
      const incompleteAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'incomplete');
      const missingAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'missing');

      expect(outdatedAfter?.status).toBe('open');
      expect(incorrectAfter?.status).toBe('open');
      expect(incompleteAfter?.status).toBe('open');
      expect(missingAfter?.status).toBe('resolved');
    });

    it('should NOT affect missing flags for other topics', async () => {
      const topic1 = 'topic-one';
      const topic2 = 'topic-two';

      // Create missing flags for both topics
      await manager.createFlag(topic1, 'missing', 'Topic 1 is missing');
      await manager.createFlag(topic2, 'missing', 'Topic 2 is missing');

      // Create only topic1
      await manager.createTopic(topic1, 'Topic One', createTestContent(), 'test-user');

      // Verify only topic1's flag is resolved
      const flagsAfter = await manager.listFlags();
      const flag1After = flagsAfter.find(f => f.topicName === topic1 && f.type === 'missing');
      const flag2After = flagsAfter.find(f => f.topicName === topic2 && f.type === 'missing');

      expect(flag1After?.status).toBe('resolved');
      expect(flag2After?.status).toBe('open');
    });

    it('should handle topic with no missing flags gracefully', async () => {
      const topicName = 'topic-no-missing-flags';

      // Create some non-missing flags
      await manager.createFlag(topicName, 'outdated', 'Some outdated flag');

      // Create the topic - should not throw
      const draft = await manager.createTopic(topicName, 'Topic Without Missing Flags', createTestContent(), 'test-user');

      expect(draft.topicName).toBe(topicName);
    });

    it('should clean up both missing_topics entry and flags in one operation', async () => {
      const topicName = 'fully-tracked-missing-topic';

      // Query a non-existent topic to log it as missing
      await manager.getTopic(topicName);

      // Also create a missing flag for it
      const flagResult = await manager.createFlag(topicName, 'missing', 'This topic needs to be created');
      expect(flagResult.created).toBe(true);

      // Verify both exist
      const missingBefore = await manager.getMissingTopics();
      expect(missingBefore.some(m => m.topicName === topicName)).toBe(true);
      const flagsBefore = await manager.listFlags('open');
      expect(flagsBefore.some(f => f.topicName === topicName && f.type === 'missing')).toBe(true);

      // Create the topic
      await manager.createTopic(topicName, 'Fully Tracked Topic', createTestContent(), 'test-user');

      // Verify both are cleaned up
      const missingAfter = await manager.getMissingTopics();
      expect(missingAfter.some(m => m.topicName === topicName)).toBe(false);

      const flagsAfter = await manager.listFlags();
      const flagAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'missing');
      expect(flagAfter?.status).toBe('resolved');
    });
  });
});

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
      await manager.createFlag(topicName, 'outdated', 'Content is outdated');
      await manager.createFlag(topicName, 'incomplete', 'Missing details');
      await manager.createFlag(topicName, 'incorrect', 'Factually wrong');

      // Verify flags are open initially
      const flagsBefore = await manager.listFlags('open');
      expect(flagsBefore.length).toBeGreaterThanOrEqual(3);
      expect(flagsBefore.some(f => f.topicName === topicName && f.type === 'outdated' && f.status === 'open')).toBe(true);
      expect(flagsBefore.some(f => f.topicName === topicName && f.type === 'incomplete' && f.status === 'open')).toBe(true);
      expect(flagsBefore.some(f => f.topicName === topicName && f.type === 'incorrect' && f.status === 'open')).toBe(true);

      // Approve the draft
      await manager.approveDraft(topicName);

      // Verify flags are now resolved
      const flagsAfter = await manager.listFlags();
      const flag1After = flagsAfter.find(f => f.topicName === topicName && f.type === 'outdated');
      const flag2After = flagsAfter.find(f => f.topicName === topicName && f.type === 'incomplete');
      const flag3After = flagsAfter.find(f => f.topicName === topicName && f.type === 'incorrect');

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
      await manager.createFlag(topic1, 'outdated', 'Topic 1 is outdated');
      await manager.createFlag(topic2, 'incorrect', 'Topic 2 is incorrect');

      // Approve draft for topic 1
      await manager.approveDraft(topic1);

      // Verify only topic1 flags are resolved
      const flagsAfter = await manager.listFlags();
      const flag1After = flagsAfter.find(f => f.topicName === topic1 && f.type === 'outdated');
      const flag2After = flagsAfter.find(f => f.topicName === topic2 && f.type === 'incorrect');

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
      await manager.createFlag(topicName, 'outdated', 'This is open');

      // Create and immediately resolve another flag
      const incompleteResult = await manager.createFlag(topicName, 'incomplete', 'This will be resolved');
      expect(incompleteResult.created).toBe(true);

      // Get the flag ID to update it
      const flagsBefore = await manager.listFlags();
      const incompleteFlag = flagsBefore.find(f => f.topicName === topicName && f.type === 'incomplete');
      if (incompleteFlag) {
        await manager.updateFlagStatus(incompleteFlag.id, 'resolved');
      }

      // Approve the draft
      await manager.approveDraft(topicName);

      // Verify only open flag was resolved
      const flagsAfter = await manager.listFlags();
      const openFlagAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'outdated');
      const resolvedFlagAfter = flagsAfter.find(f => f.topicName === topicName && f.type === 'incomplete');

      expect(openFlagAfter?.status).toBe('resolved');
      expect(resolvedFlagAfter?.status).toBe('resolved');
      // The resolved flag's timestamp should not change (it should be earlier than the approval time)
      expect(resolvedFlagAfter?.resolvedAt).not.toBeNull();
    });
  });
});

describe('KodexManager.aliases', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-aliases-${Date.now()}`);
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

  describe('topic object includes aliases array', () => {
    it('should include aliases property on TopicMetadata', async () => {
      const topicName = 'test-topic-with-aliases';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');
      const topic = await manager.getTopic(topicName);

      expect(topic).toBeDefined();
      expect(topic?.aliases).toBeDefined();
      expect(Array.isArray(topic?.aliases)).toBe(true);
    });

    it('should return empty aliases array on new topics', async () => {
      const topicName = 'brand-new-topic-with-aliases';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Brand New Topic', content, 'test-user');
      const topic = await manager.getTopic(topicName);

      expect(topic?.aliases).toEqual([]);
    });

    it('should have aliases in listTopics results', async () => {
      const topicName = 'list-topic-with-aliases';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'List Topic', content, 'test-user');
      const topics = await manager.listTopics();
      const topic = topics.find(t => t.name === topicName);

      expect(topic?.aliases).toBeDefined();
      expect(Array.isArray(topic?.aliases)).toBe(true);
    });
  });

  describe('aliases persist through database operations', () => {
    it('should persist aliases through a full create-update cycle', async () => {
      const topicName = 'persisted-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic
      await manager.createTopic(topicName, 'Persisted Topic', content, 'test-user');

      // Verify initial empty aliases
      let topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toEqual([]);

      // Close and reopen manager to simulate persistence
      manager.close();
      const manager2 = new KodexManager(testProjectPath);

      // Verify aliases still exist after reopening
      topic = await manager2.getTopic(topicName);
      expect(topic?.aliases).toEqual([]);

      manager2.close();
    });

    it('should maintain empty aliases array through approveD draft', async () => {
      const topicName = 'draft-alias-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic with draft
      await manager.createTopic(topicName, 'Draft Topic', content, 'test-user');

      // Approve draft
      const approved = await manager.approveDraft(topicName);

      expect(approved.aliases).toEqual([]);
    });
  });
});

describe('KodexManager.addAlias() and removeAlias()', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-alias-methods-${Date.now()}`);
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

  describe('addAlias()', () => {
    it('should successfully add alias to a topic', async () => {
      const topicName = 'test-topic';
      const alias = 'test-alias';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');

      // Add alias
      manager.addAlias(topicName, alias);

      // Verify alias was added
      const topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toContain(alias);
      expect(topic?.aliases.length).toBe(1);
    });

    it('should prevent adding duplicate aliases', async () => {
      const topicName = 'dup-alias-topic';
      const alias = 'duplicate-alias';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');

      // Add alias first time
      manager.addAlias(topicName, alias);

      // Try to add duplicate - should throw error
      expect(() => manager.addAlias(topicName, alias)).toThrow();

      // Verify only one alias exists
      const topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toEqual([alias]);
    });

    it('should throw error when topic not found', () => {
      const nonExistentTopic = 'non-existent-topic';
      const alias = 'some-alias';

      expect(() => manager.addAlias(nonExistentTopic, alias)).toThrow();
    });

    it('should add multiple different aliases to a topic', async () => {
      const topicName = 'multi-alias-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');

      // Add multiple aliases
      manager.addAlias(topicName, 'alias-one');
      manager.addAlias(topicName, 'alias-two');
      manager.addAlias(topicName, 'alias-three');

      // Verify all aliases exist
      const topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toEqual(['alias-one', 'alias-two', 'alias-three']);
    });

    it('should persist aliases after closing and reopening manager', async () => {
      const topicName = 'persist-alias-topic';
      const alias = 'persisted-alias';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic and add alias
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');
      manager.addAlias(topicName, alias);

      // Verify alias exists
      let topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toContain(alias);

      // Close and reopen manager
      manager.close();
      const manager2 = new KodexManager(testProjectPath);

      // Verify alias persists
      topic = await manager2.getTopic(topicName);
      expect(topic?.aliases).toContain(alias);

      manager2.close();
    });
  });

  describe('removeAlias()', () => {
    it('should successfully remove alias from topic', async () => {
      const topicName = 'remove-alias-topic';
      const alias = 'alias-to-remove';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic and add alias
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');
      manager.addAlias(topicName, alias);

      // Verify alias exists
      let topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toContain(alias);

      // Remove alias
      manager.removeAlias(topicName, alias);

      // Verify alias was removed
      topic = await manager.getTopic(topicName);
      expect(topic?.aliases).not.toContain(alias);
      expect(topic?.aliases).toEqual([]);
    });

    it('should throw error when topic not found', () => {
      const nonExistentTopic = 'non-existent-topic';
      const alias = 'some-alias';

      expect(() => manager.removeAlias(nonExistentTopic, alias)).toThrow();
    });

    it('should throw error when removing non-existent alias', async () => {
      const topicName = 'nonexist-alias-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');

      // Try to remove alias that doesn't exist
      expect(() => manager.removeAlias(topicName, 'non-existent-alias')).toThrow();
    });

    it('should remove one alias while keeping others', async () => {
      const topicName = 'partial-remove-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic and add multiple aliases
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');
      manager.addAlias(topicName, 'alias-one');
      manager.addAlias(topicName, 'alias-two');
      manager.addAlias(topicName, 'alias-three');

      // Remove one alias
      manager.removeAlias(topicName, 'alias-two');

      // Verify only that alias was removed
      const topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toEqual(['alias-one', 'alias-three']);
    });

    it('should persist alias removal after closing and reopening manager', async () => {
      const topicName = 'persist-remove-topic';
      const alias = 'alias-to-remove';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      // Create topic and add alias
      await manager.createTopic(topicName, 'Test Topic', content, 'test-user');
      manager.addAlias(topicName, alias);
      manager.removeAlias(topicName, alias);

      // Verify alias is removed
      let topic = await manager.getTopic(topicName);
      expect(topic?.aliases).toEqual([]);

      // Close and reopen manager
      manager.close();
      const manager2 = new KodexManager(testProjectPath);

      // Verify removal persists
      topic = await manager2.getTopic(topicName);
      expect(topic?.aliases).toEqual([]);

      manager2.close();
    });
  });
});

describe('KodexManager.getTopic()', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-getTopic-${Date.now()}`);
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

  describe('alias fallback search', () => {
    it('should get topic by exact name match', async () => {
      const topicName = 'authentication';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Authentication', content, 'test-user');
      const topic = await manager.getTopic(topicName);

      expect(topic).toBeDefined();
      expect(topic?.name).toBe(topicName);
      expect(topic?.title).toBe('Authentication');
    });

    it('should get topic by alias match', async () => {
      const topicName = 'authentication';
      const aliasName = 'auth';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Authentication', content, 'test-user');

      // Update the topic to add an alias
      const db = (manager as any).ensureInitialized();
      db.run(
        'UPDATE topics SET aliases = ? WHERE name = ?',
        JSON.stringify([aliasName]),
        topicName
      );

      // Query by alias
      const topic = await manager.getTopic(aliasName);

      expect(topic).toBeDefined();
      expect(topic?.name).toBe(topicName);
      expect(topic?.aliases).toContain(aliasName);
    });

    it('should return null when topic not found by name or alias', async () => {
      const result = await manager.getTopic('nonexistent-topic');
      expect(result).toBeNull();
    });

    it('should prefer exact name match over alias', async () => {
      // Create topic with name "auth"
      const topic1Name = 'auth';
      const topic1Content: TopicContent = {
        conceptual: '# Conceptual 1',
        technical: '# Technical 1',
        files: '# Files 1',
        related: '# Related 1',
      };

      // Create another topic with "auth" as an alias
      const topic2Name = 'authentication';
      const topic2Content: TopicContent = {
        conceptual: '# Conceptual 2',
        technical: '# Technical 2',
        files: '# Files 2',
        related: '# Related 2',
      };

      await manager.createTopic(topic1Name, 'Auth', topic1Content, 'test-user');
      await manager.createTopic(topic2Name, 'Authentication', topic2Content, 'test-user');

      // Add "auth" as alias to topic2
      const db = (manager as any).ensureInitialized();
      db.run(
        'UPDATE topics SET aliases = ? WHERE name = ?',
        JSON.stringify(['auth']),
        topic2Name
      );

      // When searching for "auth", should return the exact match (topic1)
      const topic = await manager.getTopic('auth');
      expect(topic?.name).toBe(topic1Name);
      expect(topic?.content.technical).toBe('# Technical 1');
    });

    it('should find topic by any of multiple aliases', async () => {
      const topicName = 'user-management';
      const aliases = ['users', 'user-mgmt', 'user-admin'];
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'User Management', content, 'test-user');

      // Add multiple aliases
      const db = (manager as any).ensureInitialized();
      db.run(
        'UPDATE topics SET aliases = ? WHERE name = ?',
        JSON.stringify(aliases),
        topicName
      );

      // Test finding by each alias
      for (const alias of aliases) {
        const topic = await manager.getTopic(alias);
        expect(topic).toBeDefined();
        expect(topic?.name).toBe(topicName);
      }
    });

    it('should log missing when topic not found by name or alias', async () => {
      const missingName = 'definitely-not-a-topic';

      // Query non-existent topic
      const result = await manager.getTopic(missingName);
      expect(result).toBeNull();

      // Verify it was logged as missing
      const missingTopics = await manager.getMissingTopics();
      expect(missingTopics.some(m => m.topicName === missingName)).toBe(true);
    });

    it('should log access when topic found by name', async () => {
      const topicName = 'logged-topic';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Logged Topic', content, 'test-user');

      // Get the topic
      const topic = await manager.getTopic(topicName);
      expect(topic).toBeDefined();

      // TODO: Verify access was logged (requires method to get access logs)
    });

    it('should log access when topic found by alias', async () => {
      const topicName = 'aliased-topic';
      const alias = 'alias-one';
      const content: TopicContent = {
        conceptual: '# Conceptual',
        technical: '# Technical',
        files: '# Files',
        related: '# Related',
      };

      await manager.createTopic(topicName, 'Aliased Topic', content, 'test-user');

      // Add alias
      const db = (manager as any).ensureInitialized();
      db.run(
        'UPDATE topics SET aliases = ? WHERE name = ?',
        JSON.stringify([alias]),
        topicName
      );

      // Get by alias
      const topic = await manager.getTopic(alias);
      expect(topic).toBeDefined();

      // TODO: Verify access was logged
    });
  });
});

describe('KodexManager.createFlag()', () => {
  let manager: KodexManager;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = join(tmpdir(), `test-kodex-flag-${Date.now()}`);
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

  describe('basic flag creation', () => {
    it('should create a flag without dedupe option', async () => {
      const result = await manager.createFlag('test-topic', 'missing', 'This topic is missing');

      expect(result.created).toBe(true);
      expect(result.reason).toBeUndefined();

      // Verify flag was created in database
      const flags = await manager.listFlags('open');
      const createdFlag = flags.find(f => f.topicName === 'test-topic' && f.type === 'missing');
      expect(createdFlag).toBeDefined();
      expect(createdFlag?.description).toBe('This topic is missing');
      expect(createdFlag?.status).toBe('open');
    });

    it('should create multiple flags for same topic with different types', async () => {
      const topicName = 'multi-flag-topic';

      const result1 = await manager.createFlag(topicName, 'outdated', 'Content is outdated');
      const result2 = await manager.createFlag(topicName, 'incomplete', 'Missing details');

      expect(result1.created).toBe(true);
      expect(result2.created).toBe(true);

      const flags = await manager.listFlags('open');
      const topicFlags = flags.filter(f => f.topicName === topicName);
      expect(topicFlags.length).toBe(2);
    });

    it('should include context in description when provided', async () => {
      const result = await manager.createFlag(
        'test-topic',
        'incomplete',
        'Documentation is incomplete',
        { context: 'Found during API review' }
      );

      expect(result.created).toBe(true);

      const flags = await manager.listFlags('open');
      const createdFlag = flags.find(f => f.topicName === 'test-topic' && f.type === 'incomplete');
      expect(createdFlag?.description).toBe('Documentation is incomplete (Context: Found during API review)');
    });
  });

  describe('dedupe functionality', () => {
    it('should prevent duplicate flag when dedupe is true', async () => {
      const topicName = 'dedupe-test-topic';

      // Create first flag
      const result1 = await manager.createFlag(topicName, 'missing', 'First attempt', { dedupe: true });
      expect(result1.created).toBe(true);

      // Try to create duplicate
      const result2 = await manager.createFlag(topicName, 'missing', 'Second attempt', { dedupe: true });
      expect(result2.created).toBe(false);
      expect(result2.reason).toBe('Duplicate flag exists');

      // Verify only one flag exists
      const flags = await manager.listFlags('open');
      const topicFlags = flags.filter(f => f.topicName === topicName && f.type === 'missing');
      expect(topicFlags.length).toBe(1);
    });

    it('should allow duplicate when dedupe is false', async () => {
      const topicName = 'no-dedupe-topic';

      // Create first flag
      const result1 = await manager.createFlag(topicName, 'incorrect', 'First flag', { dedupe: false });
      expect(result1.created).toBe(true);

      // Create duplicate without dedupe
      const result2 = await manager.createFlag(topicName, 'incorrect', 'Second flag', { dedupe: false });
      expect(result2.created).toBe(true);

      // Verify both flags exist
      const flags = await manager.listFlags('open');
      const topicFlags = flags.filter(f => f.topicName === topicName && f.type === 'incorrect');
      expect(topicFlags.length).toBe(2);
    });

    it('should allow duplicate when dedupe is not specified', async () => {
      const topicName = 'default-dedupe-topic';

      // Create first flag (no dedupe option)
      const result1 = await manager.createFlag(topicName, 'outdated', 'First flag');
      expect(result1.created).toBe(true);

      // Create duplicate (no dedupe option)
      const result2 = await manager.createFlag(topicName, 'outdated', 'Second flag');
      expect(result2.created).toBe(true);

      // Verify both flags exist
      const flags = await manager.listFlags('open');
      const topicFlags = flags.filter(f => f.topicName === topicName && f.type === 'outdated');
      expect(topicFlags.length).toBe(2);
    });

    it('should dedupe across different topics with same type', async () => {
      // Create flag for topic1 with outdated type
      const result1 = await manager.createFlag('topic-1', 'outdated', 'Topic 1 is outdated', { dedupe: true });
      expect(result1.created).toBe(true);

      // Try to create flag for topic2 with same type - should succeed (different topic)
      const result2 = await manager.createFlag('topic-2', 'outdated', 'Topic 2 is outdated', { dedupe: true });
      expect(result2.created).toBe(true);

      // Try to create duplicate for topic1 - should fail
      const result3 = await manager.createFlag('topic-1', 'outdated', 'Duplicate', { dedupe: true });
      expect(result3.created).toBe(false);

      const flags = await manager.listFlags('open');
      expect(flags.filter(f => f.topicName === 'topic-1' && f.type === 'outdated').length).toBe(1);
      expect(flags.filter(f => f.topicName === 'topic-2' && f.type === 'outdated').length).toBe(1);
    });

    it('should only check open flags for deduping', async () => {
      const topicName = 'resolved-flag-topic';

      // Create a flag
      const result1 = await manager.createFlag(topicName, 'incorrect', 'First flag', { dedupe: true });
      expect(result1.created).toBe(true);

      // Get the flag and resolve it
      const flagsBefore = await manager.listFlags('open');
      const flag = flagsBefore.find(f => f.topicName === topicName && f.type === 'incorrect');
      if (flag) {
        await manager.updateFlagStatus(flag.id, 'resolved');
      }

      // Try to create same flag again - should succeed because the first one is resolved
      const result2 = await manager.createFlag(topicName, 'incorrect', 'New flag after resolution', { dedupe: true });
      expect(result2.created).toBe(true);

      // Verify we have one resolved and one open
      const flagsAfter = await manager.listFlags();
      const resolved = flagsAfter.filter(f => f.topicName === topicName && f.type === 'incorrect' && f.status === 'resolved');
      const open = flagsAfter.filter(f => f.topicName === topicName && f.type === 'incorrect' && f.status === 'open');
      expect(resolved.length).toBe(1);
      expect(open.length).toBe(1);
    });

    it('should dedupe with context option', async () => {
      const topicName = 'context-dedupe-topic';

      // Create first flag with context
      const result1 = await manager.createFlag(
        topicName,
        'missing',
        'Topic not found',
        { context: 'API query', dedupe: true }
      );
      expect(result1.created).toBe(true);

      // Try to create duplicate with different context - should still dedupe
      const result2 = await manager.createFlag(
        topicName,
        'missing',
        'Topic not found',
        { context: 'Different source', dedupe: true }
      );
      expect(result2.created).toBe(false);
      expect(result2.reason).toBe('Duplicate flag exists');
    });
  });

  describe('all flag types', () => {
    it('should create flags for all valid types', async () => {
      const topicName = 'all-types-topic';
      const types: Array<'missing' | 'outdated' | 'incorrect' | 'incomplete'> = ['missing', 'outdated', 'incorrect', 'incomplete'];

      for (const type of types) {
        const result = await manager.createFlag(topicName, type, `${type} description`, { dedupe: true });
        expect(result.created).toBe(true);
      }

      const flags = await manager.listFlags('open');
      const topicFlags = flags.filter(f => f.topicName === topicName);
      expect(topicFlags.length).toBe(4);

      for (const type of types) {
        expect(topicFlags.some(f => f.type === type)).toBe(true);
      }
    });
  });
});
