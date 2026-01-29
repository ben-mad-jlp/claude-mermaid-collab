/**
 * Alias Generator Test Suite
 * Tests synonym and abbreviation expansion functions
 */

import { describe, it, expect } from 'vitest';
import { expandWithSynonyms, expandWithAbbreviations } from '../alias-generator';

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
      const keywords = ['authentication', 'unknown', 'database'];
      const result = expandWithSynonyms(keywords);
      expect(result).toContain('authentication');
      expect(result).toContain('auth');
      expect(result).toContain('unknown');
      expect(result).toContain('database');
      expect(result).toContain('db');
      expect(result).toContain('storage');
      expect(result).toContain('persistence');
    });

    it('should return unique results', () => {
      const keywords = ['configuration', 'configuration'];
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
});
