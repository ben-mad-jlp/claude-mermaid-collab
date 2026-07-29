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
  it('maps the legacy grok-build UI id to the live CLI id', () => {
    expect(resolveGrokModel('grok-build', 'blueprint')).toBe(GROK_MODEL_ALIASES['grok-build']);
    expect(resolveGrokModel('grok-build', 'blueprint')).toBe('grok-4.5');
  });

  it('aliases retired grok-composer-2.5-fast onto the live CLI id', () => {
    expect(resolveGrokModel('grok-composer-2.5-fast', 'implement')).toBe('grok-4.5');
  });

  it('falls back Claude alias to kind default via wave label', () => {
    expect(resolveGrokModel('sonnet', 'wimplement:src/foo.ts')).toBe('grok-4.5');
    expect(resolveGrokModel('opus', 'blueprint')).toBe('grok-4.5');
  });

  it('uses the single live model for reasoning kinds', () => {
    expect(resolveGrokModel(undefined, 'review')).toBe('grok-4.5');
  });

  it('uses the single live model for implementation kinds', () => {
    expect(resolveGrokModel(undefined, 'fix')).toBe('grok-4.5');
  });
});

describe('kindDefaultGrokModel', () => {
  it('resolves every kind to the single live CLI model', () => {
    expect(kindDefaultGrokModel('blueprint')).toBe('grok-4.5');
    expect(kindDefaultGrokModel('implement')).toBe('grok-4.5');
  });
});