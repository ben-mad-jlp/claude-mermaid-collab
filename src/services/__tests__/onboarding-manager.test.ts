import { describe, test, expect } from 'bun:test';
import { parseRelatedTopics, deriveCategories } from '../onboarding-manager.js';
import type { OnboardingConfig } from '../onboarding-manager.js';

describe('parseRelatedTopics', () => {
  const knownTopics = new Set([
    'api-authentication',
    'api-endpoints',
    'dashboard-layout',
    'picking-workflow',
    'shipping-workflow',
  ]);

  test('extracts topics from markdown links', () => {
    const content = '- [Api Authentication](../api-authentication/) — handles auth\n- [API Endpoints](../api-endpoints/) — REST endpoints';
    const result = parseRelatedTopics(content, knownTopics);
    expect(result).toContain('api-authentication');
    expect(result).toContain('api-endpoints');
  });

  test('extracts topics from bold text', () => {
    const content = '- **api-authentication** - handles authentication\n- **dashboard-layout** - the main layout';
    const result = parseRelatedTopics(content, knownTopics);
    expect(result).toContain('api-authentication');
    expect(result).toContain('dashboard-layout');
  });

  test('extracts bare words validated against known topics', () => {
    const content = '- api-authentication\n- picking-workflow';
    const result = parseRelatedTopics(content, knownTopics);
    expect(result).toContain('api-authentication');
    expect(result).toContain('picking-workflow');
  });

  test('filters out unknown topics', () => {
    const content = '- [Unknown Topic](../unknown-topic/)\n- **nonexistent**';
    const result = parseRelatedTopics(content, knownTopics);
    expect(result).toHaveLength(0);
  });

  test('deduplicates results', () => {
    const content = '- [Api Auth](../api-authentication/)\n- **api-authentication** - also mentioned\n- api-authentication';
    const result = parseRelatedTopics(content, knownTopics);
    const authCount = result.filter(t => t === 'api-authentication').length;
    expect(authCount).toBe(1);
  });

  test('handles empty content', () => {
    expect(parseRelatedTopics('', knownTopics)).toEqual([]);
    expect(parseRelatedTopics('  \n  ', knownTopics)).toEqual([]);
  });
});

describe('deriveCategories', () => {
  const topics = [
    { name: 'api-authentication' },
    { name: 'api-endpoints' },
    { name: 'api-middleware' },
    { name: 'dashboard-layout' },
    { name: 'dashboard-widgets' },
    { name: 'dashboard-filters' },
    { name: 'picking-workflow' },
    { name: 'shipping-workflow' },
  ];

  test('groups topics by prefix', () => {
    const categories = deriveCategories(topics);
    const apiCat = categories.find(c => c.name === 'api');
    expect(apiCat).toBeDefined();
    expect(apiCat!.topicCount).toBe(3);
    expect(apiCat!.topics).toContain('api-authentication');
  });

  test('merges small groups into other', () => {
    const categories = deriveCategories(topics);
    const otherCat = categories.find(c => c.name === 'other');
    // picking and shipping each have < 3 topics
    expect(otherCat).toBeDefined();
    expect(otherCat!.topics).toContain('picking-workflow');
    expect(otherCat!.topics).toContain('shipping-workflow');
  });

  test('sorts by topicCount descending', () => {
    const categories = deriveCategories(topics);
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i - 1].topicCount).toBeGreaterThanOrEqual(categories[i].topicCount);
    }
  });

  test('applies config category overrides', () => {
    const config: OnboardingConfig = {
      title: 'Test',
      topicCount: 8,
      defaultMode: 'browse',
      categories: {
        'workflows': ['picking-workflow', 'shipping-workflow', 'api-middleware'],
      },
    };
    const categories = deriveCategories(topics, config);
    const wfCat = categories.find(c => c.name === 'workflows');
    expect(wfCat).toBeDefined();
    expect(wfCat!.topicCount).toBe(3);
    expect(wfCat!.topics).toContain('picking-workflow');
  });
});
