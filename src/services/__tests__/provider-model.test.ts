import { describe, it, expect } from 'bun:test';
import { isModelForProvider, providerModelMismatch } from '../provider-model';

describe('provider-model', () => {
  describe('providerModelMismatch', () => {
    it('returns null for valid claude model on claude provider', () => {
      expect(providerModelMismatch('claude', 'opus')).toBeNull();
      expect(providerModelMismatch('claude', 'sonnet')).toBeNull();
      expect(providerModelMismatch('claude', 'haiku')).toBeNull();
    });

    it('returns null for valid grok-build model on grok-build provider', () => {
      expect(providerModelMismatch('grok-build', 'grok-build')).toBeNull();
      expect(providerModelMismatch('grok-build', 'grok-build-0.1')).toBeNull();
      expect(providerModelMismatch('grok-build', 'grok-composer-2.5-fast')).toBeNull();
      expect(providerModelMismatch('grok-build', 'composer-2.5')).toBeNull();
    });

    it('returns null for valid grok-api model on grok-api provider', () => {
      expect(providerModelMismatch('grok-api', 'grok-4.3')).toBeNull();
    });

    it('returns null for null/empty model', () => {
      expect(providerModelMismatch('claude', null)).toBeNull();
      expect(providerModelMismatch('claude', undefined)).toBeNull();
      expect(providerModelMismatch('claude', '')).toBeNull();
      expect(providerModelMismatch('claude', '   ')).toBeNull();
    });

    it('returns actionable message for mismatch: grok-4.3 on claude', () => {
      const msg = providerModelMismatch('claude', 'grok-4.3');
      expect(msg).toBeTruthy();
      expect(msg).toContain('grok-4.3');
      expect(msg).toContain('claude');
      expect(msg).toContain('grok-api');
    });

    it('returns actionable message for mismatch: opus on grok-api', () => {
      const msg = providerModelMismatch('grok-api', 'opus');
      expect(msg).toBeTruthy();
      expect(msg).toContain('opus');
      expect(msg).toContain('grok-api');
      expect(msg).toContain('claude');
    });

    it('returns actionable message for mismatch: grok-4.3 on grok-build', () => {
      const msg = providerModelMismatch('grok-build', 'grok-4.3');
      expect(msg).toBeTruthy();
      expect(msg).toContain('grok-4.3');
      expect(msg).toContain('grok-build');
      expect(msg).toContain('grok-api');
    });
  });

  describe('isModelForProvider', () => {
    it('correctly identifies valid models for each provider', () => {
      expect(isModelForProvider('claude', 'opus')).toBe(true);
      expect(isModelForProvider('grok-build', 'grok-build')).toBe(true);
      expect(isModelForProvider('grok-api', 'grok-4.3')).toBe(true);
    });

    it('correctly rejects invalid models', () => {
      expect(isModelForProvider('claude', 'grok-4.3')).toBe(false);
      expect(isModelForProvider('grok-build', 'opus')).toBe(false);
      expect(isModelForProvider('grok-api', 'opus')).toBe(false);
    });
  });
});
