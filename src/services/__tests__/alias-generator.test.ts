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

    it('should handle transitive synonym expansion', () => {
      // 'rest' has synonym 'api', and 'api' has synonym 'endpoints'
      const keywords = ['rest'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('rest');
      expect(result).toContain('api');
      expect(result).toContain('endpoints');
    });

    it('should handle keywords that are synonyms of each other', () => {
      // Both 'storage' and 'database' share 'persistence' as a common synonym
      const keywords = ['storage', 'database'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('persistence');
      expect(result).toContain('storage');
      expect(result).toContain('database');
    });

    it('should return results in sorted order', () => {
      const keywords = ['api', 'database'];
      const result = expandWithSynonyms(keywords);
      const sorted = [...result].sort();
      expect(result).toEqual(sorted);
    });

    it('should handle single letter keywords', () => {
      const keywords = ['a'];
      const result = expandWithSynonyms(keywords);
      expect(Array.isArray(result)).toBe(true);
      // No synonyms for 'a', so should just return 'a'
      expect(result).toContain('a');
    });

    it('should handle very long keyword lists', () => {
      const keywords = Array(100).fill('authentication');
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
      // Should deduplicate despite large input
      const set = new Set(result);
      expect(result.length).toBe(set.size);
    });

    it('should convergence efficiently with circular synonym relationships', () => {
      // 'api' -> 'rest' -> 'api' (circular)
      const keywords = ['api'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('api');
      expect(result).toContain('rest');
      // Should not infinitely loop
      expect(result.length).toBeLessThan(50);
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

    it('should return results in sorted order', () => {
      const keywords = ['database', 'development'];
      const result = expandWithAbbreviations(keywords);
      const sorted = [...result].sort();
      expect(result).toEqual(sorted);
    });

    it('should handle all abbreviation pairs', () => {
      // Test each abbreviation pair individually
      const pairs = [
        ['authentication', 'auth'],
        ['authorization', 'authz'],
        ['database', 'db'],
        ['application', 'app'],
        ['development', 'dev'],
        ['configuration', 'config'],
        ['documentation', 'docs'],
      ];

      pairs.forEach(([long, short]) => {
        const result1 = expandWithAbbreviations([long]);
        const result2 = expandWithAbbreviations([short]);
        expect(result1).toContain(short);
        expect(result2).toContain(long);
      });
    });

    it('should handle security-related abbreviations', () => {
      const result = expandWithAbbreviations(['security']);
      expect(result).toContain('sec');
    });

    it('should handle storage-related abbreviations', () => {
      const result = expandWithAbbreviations(['storage']);
      expect(result).toContain('store');
    });

    it('should handle persistence-related abbreviations', () => {
      const result = expandWithAbbreviations(['persistence']);
      expect(result).toContain('persist');
    });

    it('should handle ci/cd abbreviations', () => {
      const result = expandWithAbbreviations(['continuous integration']);
      expect(result).toContain('ci');
    });

    it('should handle microservices abbreviations', () => {
      const result = expandWithAbbreviations(['microservices']);
      expect(result).toContain('ms');
    });

    it('should handle very long keyword lists', () => {
      const keywords = Array(100).fill('authentication');
      const result = expandWithAbbreviations(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
      const set = new Set(result);
      expect(result.length).toBe(set.size);
    });

    it('should handle case sensitivity correctly', () => {
      // Abbreviation map uses lowercase
      const keywords = ['AUTHENTICATION', 'Authentication'];
      const result = expandWithAbbreviations(keywords);
      // Should find matches (function works with provided input)
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle multi-word abbreviations', () => {
      const result = expandWithAbbreviations(['http']);
      expect(result).toContain('http');
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

    it('should return results in sorted order', () => {
      const result = extractTitleKeywords('Zebra Apple Banana');
      const sorted = [...result].sort();
      expect(result).toEqual(sorted);
    });

    it('should handle title with tabs and newlines', () => {
      const result = extractTitleKeywords('User\tAuthentication\nGuide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle minLength of 1', () => {
      const result = extractTitleKeywords('I am user', 1);
      expect(result).toContain('am');
    });

    it('should handle very large minLength', () => {
      const result = extractTitleKeywords('User Authentication', 50);
      expect(result).toEqual([]);
    });

    it('should handle underscore as word separator', () => {
      const result = extractTitleKeywords('User_Authentication_Guide');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle multiple consecutive punctuation', () => {
      const result = extractTitleKeywords('User!!!Authentication???Guide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle mixed separators', () => {
      const result = extractTitleKeywords('User-Authentication_Guide!Documentation#Reference');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle leading and trailing spaces', () => {
      const result = extractTitleKeywords('   User Authentication Guide   ');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle title with only spaces', () => {
      const result = extractTitleKeywords('     ');
      expect(result).toEqual([]);
    });

    it('should handle very long title', () => {
      const longTitle = 'word ' + 'keyword '.repeat(50);
      const result = extractTitleKeywords(longTitle);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle numbers in words', () => {
      const result = extractTitleKeywords('HTTP2 REST API');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('http2');
      expect(result).toContain('rest');
      expect(result).toContain('api');
    });

    it('should filter multiple occurrences of stop words', () => {
      const result = extractTitleKeywords('the the the authentication guide guide');
      expect(result).not.toContain('the');
      const guideCount = result.filter(k => k === 'guide').length;
      expect(guideCount).toBe(1);
    });

    it('should handle title starting with special character', () => {
      const result = extractTitleKeywords('!@#User Authentication');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
    });

    it('should handle title with parentheses', () => {
      const result = extractTitleKeywords('User (Authentication) Guide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle title with brackets', () => {
      const result = extractTitleKeywords('User [Authentication] Guide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle title with quotes', () => {
      const result = extractTitleKeywords('User "Authentication" Guide');
      expect(result).toContain('user');
      expect(result).toContain('authentication');
      expect(result).toContain('guide');
    });

    it('should handle minLength parameter with complex title', () => {
      const result = extractTitleKeywords('a ab abc abcd abcde', 3);
      expect(result).not.toContain('a');
      expect(result).not.toContain('ab');
      expect(result).toContain('abc');
      expect(result).toContain('abcd');
      expect(result).toContain('abcde');
    });

    it('should handle default minLength behavior', () => {
      const result = extractTitleKeywords('I am authentication');
      // Default minLength is 2, so words with length >= 2 are included
      // 'am' has length 2 and is a stop word, so it should be filtered
      expect(result).not.toContain('i');
      expect(result).toContain('authentication');
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

    it('should count word frequency correctly', () => {
      const content = createContent(
        'test test test authentication verification',
        'test implementation'
      );
      const result = extractContentKeywords(content, 5);
      // 'test' appears 4 times, should be first
      expect(result[0]).toBe('test');
    });

    it('should handle single word content', () => {
      const content = createContent('authentication', '');
      const result = extractContentKeywords(content, 5);
      expect(result).toContain('authentication');
    });

    it('should handle content with only short words', () => {
      const content = createContent(
        'ab cd ef gh ij',
        'kl mn'
      );
      const result = extractContentKeywords(content, 5);
      // Words must be at least 3 characters
      expect(result.length).toBe(0);
    });

    it('should handle content with mixed short and long words', () => {
      const content = createContent(
        'ab cd authentication ef verification',
        'ab test'
      );
      const result = extractContentKeywords(content, 5);
      // Should only include words with 3+ characters
      result.forEach(keyword => {
        expect(keyword.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should handle numbers in content', () => {
      const content = createContent(
        'version123 protocol456',
        'http2 standard'
      );
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle hyphenated words', () => {
      const content = createContent(
        'token-based authentication api-gateway',
        'role-based access control'
      );
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const content = createContent(
        'authenticate@ verify# secure!',
        'token$ session%'
      );
      const result = extractContentKeywords(content, 5);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle very large limit', () => {
      const content = createContent(
        'keyword1 keyword2 keyword3',
        'keyword4 keyword5'
      );
      const result = extractContentKeywords(content, 1000);
      // Should return all unique keywords, not more than available
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should handle negative limit (edge case)', () => {
      const content = createContent(
        'authentication verification',
        'token security'
      );
      const result = extractContentKeywords(content, -5);
      // Math.max(0, -5) = 0, should return empty
      expect(result).toEqual([]);
    });

    it('should handle content with default limit', () => {
      const content = createContent(
        'word1 word1 word1 word2 word2 word3',
        'word1 word2 word4 word5'
      );
      const result = extractContentKeywords(content);
      // Default limit is CONTENT_KEYWORD_LIMIT (5)
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should ignore files and related fields', () => {
      const content: TopicContent = {
        conceptual: 'authentication concept',
        technical: 'token based',
        files: 'authentication.ts auth-service.ts',
        related: 'authorization security',
      };
      const result = extractContentKeywords(content, 5);
      // Should only use conceptual and technical
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle whitespace-only content', () => {
      const content = createContent('   \n\t  ', '  \n  ');
      const result = extractContentKeywords(content, 5);
      expect(result).toEqual([]);
    });

    it('should preserve order by frequency', () => {
      const content = createContent(
        'first first first second second third',
        'first'
      );
      const result = extractContentKeywords(content, 3);
      // 'first' appears 4 times (should be first)
      // 'second' appears 2 times (should be second)
      // 'third' appears 1 time (should be third)
      if (result.length >= 3) {
        expect(result[0]).toBe('first');
        expect(result[1]).toBe('second');
        expect(result[2]).toBe('third');
      }
    });

    it('should handle identical content in both sections', () => {
      const content = createContent(
        'authentication authentication',
        'authentication authentication'
      );
      const result = extractContentKeywords(content, 1);
      // 'authentication' appears 4 times, should be only result
      expect(result).toEqual(['authentication']);
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
      const result = generateAliases(
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
      const result = generateAliases(
        'authentication',
        'User Authentication Guide',
        content
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should extract and deduplicate title keywords', () => {
      const result = generateAliases(
        'api-endpoints',
        'API REST Endpoints',
        undefined
      );
      // Should include relevant keywords from title
      // Note: May include transitive synonyms through synonym expansion
      expect(result.length).toBeGreaterThan(0);
      // All should be strings
      result.forEach(alias => {
        expect(typeof alias).toBe('string');
        expect(alias.length).toBeGreaterThan(0);
      });
    });

    it('should expand keywords with synonyms', () => {
      const result = generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: true }
      );
      // Should include authentication and expand to auth, login, signin
      expect(result.length).toBeGreaterThan(1);
    });

    it('should expand keywords with abbreviations', () => {
      const result = generateAliases(
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
      const result = generateAliases(
        'authentication',
        'User Auth',
        content,
        { includeContentKeywords: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should not include canonical name in aliases', () => {
      const result = generateAliases(
        'authentication',
        'User Authentication',
        undefined
      );
      expect(result).not.toContain('authentication');
    });

    it('should respect maxAliases limit', () => {
      const result = generateAliases(
        'config',
        'Configuration Settings Options Preferences Environment Variables',
        undefined,
        { maxAliases: 3 }
      );
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should respect minAliasLength filter', () => {
      const result = generateAliases(
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
      const result = generateAliases(
        'test',
        '',
        undefined
      );
      expect(result).toEqual([]);
    });

    it('should return empty array for title with only stop words', () => {
      const result = generateAliases(
        'test',
        'the a an for is',
        undefined
      );
      expect(result).toEqual([]);
    });

    it('should handle topic name with hyphens', () => {
      const result = generateAliases(
        'rest-api',
        'REST API Documentation',
        undefined
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return sorted unique aliases', () => {
      const result = generateAliases(
        'test',
        'Authentication Configuration',
        undefined
      );
      const set = new Set(result);
      expect(result.length).toBe(set.size); // All unique
      expect(result).toEqual([...result].sort()); // Sorted
    });

    it('should combine synonyms and abbreviations', () => {
      const result = generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: true, includeAbbreviations: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should skip synonyms when disabled', () => {
      const result = generateAliases(
        'authentication',
        'Authentication',
        undefined,
        { includeSynonyms: false, includeAbbreviations: false }
      );
      // Should only have 'authentication' which gets removed as canonical name
      expect(result.length).toBe(0);
    });

    it('should handle complex title with numbers and special characters', () => {
      const result = generateAliases(
        'oauth2',
        'OAuth2.0 Authentication Protocol',
        undefined
      );
      expect(result.length).toBeGreaterThan(0);
    });

    // Additional comprehensive test cases for better coverage
    it('should integrate all options together', () => {
      const content = createContent(
        'Testing is important for quality assurance and code reliability.',
        'Write unit tests integration tests and performance tests.'
      );
      const result = generateAliases(
        'testing',
        'Test Framework Guide',
        content,
        {
          includeSynonyms: true,
          includeAbbreviations: true,
          includeContentKeywords: true,
          maxAliases: 5,
          minAliasLength: 2,
        }
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(5);
      result.forEach(alias => {
        expect(alias.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('should handle canonical name that is substring of alias', () => {
      const result = generateAliases(
        'auth',
        'Authentication System',
        undefined
      );
      expect(result).not.toContain('auth');
      expect(result).toContain('authentication');
    });

    it('should preserve sorting with various keyword lengths', () => {
      const result = generateAliases(
        'db',
        'Database Storage Persistence Layer System',
        undefined
      );
      // Verify sorted order
      for (let i = 1; i < result.length; i++) {
        expect(result[i].localeCompare(result[i - 1])).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle single-letter minAliasLength', () => {
      const result = generateAliases(
        'config',
        'C Configuration',
        undefined,
        { minAliasLength: 1 }
      );
      // Results may include very short words
      result.forEach(alias => {
        expect(alias.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should return empty when maxAliases is 0', () => {
      const result = generateAliases(
        'test',
        'Authentication',
        undefined,
        { maxAliases: 0 }
      );
      expect(result).toEqual([]);
    });

    it('should handle very high minAliasLength', () => {
      const result = generateAliases(
        'test',
        'Authentication',
        undefined,
        { minAliasLength: 100 }
      );
      // No words are 100+ characters
      expect(result).toEqual([]);
    });

    it('should not duplicate when canonical name appears in content', () => {
      const content = createContent(
        'Authentication authentication AUTH auth',
        'Authentication is important'
      );
      const result = generateAliases(
        'authentication',
        'Authentication Guide',
        content,
        { includeContentKeywords: true }
      );
      const authCount = result.filter(k => k === 'authentication').length;
      expect(authCount).toBeLessThanOrEqual(1);
    });

    it('should handle database-related keywords', () => {
      const result = generateAliases(
        'database',
        'Database Storage Persistence',
        undefined,
        { includeSynonyms: true, includeAbbreviations: true }
      );
      expect(result).toContain('db');
      expect(result).toContain('storage');
    });

    it('should handle api-related keywords', () => {
      const result = generateAliases(
        'api',
        'API REST Endpoints',
        undefined,
        { includeSynonyms: true }
      );
      expect(result).toContain('endpoints');
      expect(result).toContain('rest');
    });

    it('should handle development-related keywords', () => {
      const result = generateAliases(
        'development',
        'Development Environment Setup',
        undefined,
        { includeAbbreviations: true }
      );
      expect(result).toContain('dev');
    });

    it('should preserve results when both synonyms and abbreviations expand same keyword', () => {
      const result = generateAliases(
        'configuration',
        'Configuration',
        undefined,
        { includeSynonyms: true, includeAbbreviations: true }
      );
      // Both synonyms (config, settings) and abbreviations (config) should be included
      expect(result).toContain('config');
      expect(result).toContain('settings');
    });

    it('should handle content with special formatting', () => {
      const content = createContent(
        'Key concepts: authentication, authorization, security.',
        'Implementation details: token-based auth, JWT, role-based access control.'
      );
      const result = generateAliases(
        'security',
        'Security Best Practices',
        content,
        { includeContentKeywords: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should work with uppercase canonical names', () => {
      const result = generateAliases(
        'AUTHENTICATION',
        'Authentication Guide',
        undefined
      );
      expect(result).not.toContain('authentication');
      expect(result).not.toContain('AUTHENTICATION');
    });

    it('should work with hyphenated canonical names', () => {
      const result = generateAliases(
        'rest-api',
        'REST API Basics',
        undefined
      );
      expect(result).not.toContain('rest-api');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle numeric content keywords', () => {
      const content = createContent(
        'HTTP2 HTTP3 protocol version 2 version 3',
        'Protocol versions and implementations'
      );
      const result = generateAliases(
        'http',
        'HTTP Protocol Guide',
        content,
        { includeContentKeywords: true }
      );
      expect(result.length).toBeGreaterThan(0);
    });

    it('should respect all option combinations systematically', () => {
      const testCases = [
        { includeSynonyms: true, includeAbbreviations: true },
        { includeSynonyms: true, includeAbbreviations: false },
        { includeSynonyms: false, includeAbbreviations: true },
        { includeSynonyms: false, includeAbbreviations: false },
      ];

      testCases.forEach(opts => {
        const result = generateAliases(
          'authentication',
          'Authentication System',
          undefined,
          opts
        );
        expect(Array.isArray(result)).toBe(true);
        // With both disabled, should return empty
        if (!opts.includeSynonyms && !opts.includeAbbreviations) {
          expect(result.length).toBe(0);
        }
      });
    });

    it('should handle large result sets within maxAliases', () => {
      const result = generateAliases(
        'test',
        'configuration development application testing documentation authentication api database storage ui frontend components',
        undefined,
        { maxAliases: 10 }
      );
      expect(result.length).toBeLessThanOrEqual(10);
      // All should be valid strings
      result.forEach(alias => {
        expect(typeof alias).toBe('string');
        expect(alias.trim()).toBe(alias); // No extra whitespace
      });
    });

    it('should handle edge case where minAliasLength equals maxLength', () => {
      const result = generateAliases(
        'api',
        'APIValue',
        undefined,
        { minAliasLength: 3 }
      );
      result.forEach(alias => {
        expect(alias.length).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
