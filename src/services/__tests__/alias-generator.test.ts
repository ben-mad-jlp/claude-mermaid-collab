/**
 * Alias Generator Test Suite
 * Tests synonym and abbreviation expansion functions
 */

import { describe, it, expect } from 'vitest';
import {
  expandWithSynonyms,
  expandWithAbbreviations,
  extractTitleKeywords,
  extractContentKeywords,
  generateAliases,
  TopicContent,
} from '../alias-generator';

describe('Alias Generator', () => {
  describe('expandWithSynonyms', () => {
    it('should return original keywords when no synonyms exist', () => {
      const keywords = ['unknown', 'notfound'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('unknown');
      expect(result).toContain('notfound');
    });

    it('should expand single keyword with synonyms', () => {
      const keywords = ['authentication'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
      expect(result).toContain('login');
      expect(result).toContain('signin');
    });

    it('should expand multiple keywords with synonyms', () => {
      const keywords = ['authentication', 'ui'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
      expect(result).toContain('login');
      expect(result).toContain('ui');
      expect(result).toContain('interface');
      expect(result).toContain('frontend');
      expect(result).toContain('gui');
    });

    it('should deduplicate expanded keywords', () => {
      const keywords = ['authentication', 'authentication'];
      const result = expandWithSynonyms(keywords);
      const authCount = result.filter(k => k === 'authentication').length;
      expect(authCount).toBe(1);
    });

    it('should include both original keywords and synonyms', () => {
      const keywords = ['api'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('api');
      expect(result).toContain('endpoints');
      expect(result).toContain('routes');
      expect(result).toContain('rest');
    });

    it('should handle empty keyword list', () => {
      const keywords = [];
      const result = expandWithSynonyms(keywords);
      expect(result).toEqual([]);
    });

    it('should handle mix of known and unknown keywords', () => {
      const keywords = ['auth', 'unknown', 'db'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('auth');
      expect(result).toContain('authentication');
      expect(result).toContain('unknown');
      expect(result).toContain('db');
      expect(result).toContain('database');
      expect(result).toContain('storage');
      expect(result).toContain('data');
    });

    it('should return unique results', () => {
      const keywords = ['config', 'config'];
      const result = expandWithSynonyms(keywords);
      const resultSet = new Set(result);
      expect(result.length).toBe(resultSet.size);
    });
  });

  describe('expandWithAbbreviations', () => {
    it('should return original keywords when no abbreviations exist', () => {
      const keywords = ['unknown', 'notfound'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('unknown');
      expect(result).toContain('notfound');
    });

    it('should expand long form to abbreviation', () => {
      const keywords = ['authentication'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
    });

    it('should expand abbreviation to long form', () => {
      const keywords = ['auth'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('auth');
      expect(result).toContain('authentication');
    });

    it('should expand multiple keywords with abbreviations', () => {
      const keywords = ['configuration', 'development'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('configuration');
      expect(result).toContain('config');
      expect(result).toContain('development');
      expect(result).toContain('dev');
    });

    it('should deduplicate expanded keywords', () => {
      const keywords = ['authentication', 'authentication'];
      const result = expandWithAbbreviations(keywords);
      const authCount = result.filter(k => k === 'authentication').length;
      expect(authCount).toBe(1);
    });

    it('should handle mixed long and short forms', () => {
      const keywords = ['auth', 'configuration'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('auth');
      expect(result).toContain('authentication');
      expect(result).toContain('configuration');
      expect(result).toContain('config');
    });

    it('should handle empty keyword list', () => {
      const keywords = [];
      const result = expandWithAbbreviations(keywords);
      expect(result).toEqual([]);
    });

    it('should return unique results', () => {
      const keywords = ['application', 'app'];
      const result = expandWithAbbreviations(keywords);
      const resultSet = new Set(result);
      expect(result.length).toBe(resultSet.size);
    });

    it('should handle keywords that are both abbreviation and long form', () => {
      const keywords = ['app'];
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('app');
      expect(result).toContain('application');
    });
  });

  describe('extractTitleKeywords', () => {
    it('should extract simple keywords from title', () => {
      const result = extractTitleKeywords('User Authentication Guide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should filter out stop words', () => {
      const result = extractTitleKeywords('The Guide for Authentication');
      expect(result).not.toContain('the');
      expect(result).not.toContain('for');
      expect(result).toContain('guide');
      expect(result).toContain('authentication');
    });

    it('should lowercase all keywords', () => {
      const result = extractTitleKeywords('USER AUTHENTICATION');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
    });

    it('should filter out short words by default (length < 2)', () => {
      const result = extractTitleKeywords('A User Guide', 2);
      expect(result).not.toContain('a');
      expect(result).toContain('user');
      expect(result).toContain('guide');
    });

    it('should respect minLength parameter', () => {
      const result = extractTitleKeywords('User Auth Guide', 4);
      expect(result).toContain('user');
      expect(result).toContain('guide');
    });

    it('should return unique keywords', () => {
      const result = extractTitleKeywords('User User Guide');
      const userCount = result.filter(k => k === 'user').length;
      expect(userCount).toBe(1);
    });

    it('should handle empty title', () => {
      const result = extractTitleKeywords('');
      expect(result).toEqual([]);
    });

    it('should handle title with only stop words', () => {
      const result = extractTitleKeywords('a the for is');
      expect(result).toEqual([]);
    });

    it('should handle title with hyphens', () => {
      const result = extractTitleKeywords('User-Authentication-Guide');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle title with special characters', () => {
      const result = extractTitleKeywords('User@Authentication#Guide!');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle single word title', () => {
      const result = extractTitleKeywords('Authentication');
      expect(result).toContain('authentication');
    });

    it('should handle title with numbers', () => {
      const result = extractTitleKeywords('User123 Guide456');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('extractContentKeywords', () => {
    const createContent = (conceptual: string, technical: string): TopicContent => ({
      conceptual,
      technical,
      files: '',
      related: '',
    });

    it('should extract keywords from content sections', () => {
      const content = createContent(
        'Authentication is the process of verifying user identity.',
        'Use token-based authentication for API security.'
      );
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should return most frequent keywords', () => {
      const content = createContent(
        'Authentication authentication verify verify verify',
        'Token token token token'
      );
      const result = extractContentKeywords(content, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should filter out stop words', () => {
      const content = createContent(
        'The the a an and authentication is for',
        'The token the is'
      );
      const result = extractContentKeywords(content, 5);
      expect(result).not.toContain('the');
      expect(result).not.toContain('a');
      expect(result).not.toContain('an');
      expect(result).not.toContain('and');
      expect(result).not.toContain('is');
      expect(result).not.toContain('for');
    });

    it('should respect limit parameter', () => {
      const content = createContent(
        'word1 word2 word3 word4 word5 word6 word7 word8',
        'word1 word2 word3'
      );
      const result = extractContentKeywords(content, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should handle empty content sections', () => {
      const content = createContent('', '');
      const result = extractContentKeywords(content, 5);
      expect(result).toEqual([]);
    });

    it('should handle content with only stop words', () => {
      const content = createContent(
        'the a an and is for at',
        'the a an'
      );
      const result = extractContentKeywords(content, 5);
      expect(result).toEqual([]);
    });

    it('should handle content with mixed case', () => {
      const content = createContent(
        'Authentication AUTHENTICATION authentication',
        'Token TOKEN'
      );
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should ignore very long content efficiently', () => {
      const longContent = 'word ' + 'repeated '.repeat(100);
      const content = createContent(longContent, longContent);
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array when limit is 0', () => {
      const content = createContent(
        'Authentication verification',
        'Token security'
      );
      const result = extractContentKeywords(content, 0);
      expect(result).toEqual([]);
    });

    it('should return unique keywords only', () => {
      const content = createContent(
        'keyword keyword keyword',
        'keyword'
      );
      const result = extractContentKeywords(content, 10);
      const keywordCount = result.filter(k => k === 'keyword').length;
      expect(keywordCount).toBeLessThanOrEqual(1);
    });

    it('should combine conceptual and technical sections', () => {
      const content = createContent(
        'conceptual word appears here',
        'technical word also here'
      );
      const result = extractContentKeywords(content, 10);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should prefer longer words (min length 3)', () => {
      const content = createContent(
        'ab abc abcd abcde authentication',
        'token security'
      );
      const result = extractContentKeywords(content, 10);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateAliases', () => {
    const createContent = (conceptual: string, technical: string): TopicContent => ({
      conceptual,
      technical,
      files: '',
      related: '',
    });

    it('should generate aliases from topic title only', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'User Authentication',
        undefined
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should generate aliases from topic with title and content', () => {
      const content = createContent(
        'Authentication is the process of verifying user identity.',
        'Use token-based authentication for API security.'
      );
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'User Authentication Guide',
        content
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should extract and deduplicate title keywords', () => {
      const result = require('../alias-generator').generateAliases(
        'api-endpoints',
        'API REST Endpoints',
        undefined
      );
      // Should include api, rest, endpoints
      expect(result).toContain('api');
      expect(result).toContain('rest');
      expect(result).toContain('endpoints');
    });

    it('should expand keywords with synonyms', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: true }
      );
      // Should include authentication and expand to auth, login, signin
      expect(result.length).toBeGreaterThan(1);
    });

    it('should expand keywords with abbreviations', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'Authentication System',
        undefined,
        { includeAbbreviations: true }
      );
      // Should include authentication and auth abbreviation
      expect(result).toContain('auth');
    });

    it('should include content keywords when enabled', () => {
      const content = createContent(
        'Authentication is crucial for security.',
        'Use token-based authentication with jwt.'
      );
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'User Auth',
        content,
        { includeContentKeywords: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should not include canonical name in aliases', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'User Authentication',
        undefined
      );
      expect(result).not.toContain('authentication');
    });

    it('should respect maxAliases limit', () => {
      const result = require('../alias-generator').generateAliases(
        'config',
        'Configuration Settings Options Preferences Environment Variables',
        undefined,
        { maxAliases: 3 }
      );
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should respect minAliasLength filter', () => {
      const result = require('../alias-generator').generateAliases(
        'auth',
        'Authentication API',
        undefined,
        { minAliasLength: 4 }
      );
      // All results should have length >= 4
      result.forEach((alias: string) => {
        expect(alias.length).toBeGreaterThanOrEqual(4);
      });
    });

    it('should return empty array for empty title', () => {
      const result = require('../alias-generator').generateAliases(
        'test',
        '',
        undefined
      );
      expect(result).toEqual([]);
    });

    it('should return empty array for title with only stop words', () => {
      const result = require('../alias-generator').generateAliases(
        'test',
        'the a an for is',
        undefined
      );
      expect(result).toEqual([]);
    });

    it('should handle topic name with hyphens', () => {
      const result = require('../alias-generator').generateAliases(
        'rest-api',
        'REST API Documentation',
        undefined
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return sorted unique aliases', () => {
      const result = require('../alias-generator').generateAliases(
        'test',
        'Authentication Configuration',
        undefined
      );
      const set = new Set(result);
      expect(result.length).toBe(set.size); // All unique
      expect(result).toEqual([...result].sort()); // Sorted
    });

    it('should combine synonyms and abbreviations', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: true, includeAbbreviations: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should skip synonyms when disabled', () => {
      const result = require('../alias-generator').generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: false, includeAbbreviations: false }
      );
      // Should only have 'authentication' which gets removed as canonical name
      expect(result.length).toBe(0);
    });

    it('should handle complex title with numbers and special characters', () => {
      const result = require('../alias-generator').generateAliases(
        'oauth2',
        'OAuth2.0 Authentication Protocol',
        undefined
      );
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
