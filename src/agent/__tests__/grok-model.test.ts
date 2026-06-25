/**
 * Unit tests for grok CLI model resolution (PR-1).
 */
import { describe, it, expect } from 'bun:test';
import {
  parseKindFromTranscriptLabel,
  resolveGrokModel,
  kindDefaultGrokModel,
  GROK_MODEL_ALIASES,
} from '../grok-model.ts';

describe('parseKindFromTranscriptLabel', () => {
  it('returns floor kinds verbatim', () => {
    expect(parseKindFromTranscriptLabel('blueprint')).toBe('blueprint');
    expect(parseKindFromTranscriptLabel('implement')).toBe('implement');
  });

  it('parses wave labels kind:ref', () => {
    expect(parseKindFromTranscriptLabel('wimplement:src/foo.ts')).toBe('wimplement');
    expect(parseKindFromTranscriptLabel('research:task-1')).toBe('research');
  });

  it('returns undefined for unknown labels', () => {
    expect(parseKindFromTranscriptLabel('bogus')).toBeUndefined();
    expect(parseKindFromTranscriptLabel(undefined)).toBeUndefined();
  });
});

describe('resolveGrokModel', () => {
  it('maps grok-build UI id to CLI id', () => {
    expect(resolveGrokModel('grok-build', 'blueprint')).toBe(GROK_MODEL_ALIASES['grok-build']);
    expect(resolveGrokModel('grok-build', 'blueprint')).toBe('grok-build');
  });

  it('passthrough grok-composer-2.5-fast', () => {
    expect(resolveGrokModel('grok-composer-2.5-fast', 'implement')).toBe('grok-composer-2.5-fast');
  });

  it('falls back Claude alias to kind default via wave label', () => {
    expect(resolveGrokModel('sonnet', 'wimplement:src/foo.ts')).toBe('grok-composer-2.5-fast');
    expect(resolveGrokModel('opus', 'blueprint')).toBe('grok-build');
  });

  it('uses reasoning default when kind hint is reasoning-heavy', () => {
    expect(resolveGrokModel(undefined, 'review')).toBe('grok-build');
  });

  it('uses composer default when kind hint is implementation', () => {
    expect(resolveGrokModel(undefined, 'fix')).toBe('grok-composer-2.5-fast');
  });
});

describe('kindDefaultGrokModel', () => {
  it('classifies blueprint vs implement', () => {
    expect(kindDefaultGrokModel('blueprint')).toBe('grok-build');
    expect(kindDefaultGrokModel('implement')).toBe('grok-composer-2.5-fast');
  });
});