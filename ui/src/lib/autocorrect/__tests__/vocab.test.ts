import { describe, it, expect } from 'vitest';
import { buildProjectVocab, type VocabSnapshot } from '../vocab';

describe('buildProjectVocab', () => {
  it('includes tokenized words in protected and long words in targets', () => {
    const snapshot: VocabSnapshot = {
      sessionNames: [],
      docNames: [],
      todoTitles: ['Bridge mission reclaim'],
      fileSegments: [],
      slashCommands: ['/collab'],
      mcpToolNames: [],
    };

    const result = buildProjectVocab(snapshot);

    expect(result.protected.has('mission')).toBe(true);
    expect(result.targets.has('mission')).toBe(true);
  });

  it('includes 3-letter tokens in protected but not in targets', () => {
    const snapshot: VocabSnapshot = {
      sessionNames: [],
      docNames: [],
      todoTitles: ['the bridge'],
      fileSegments: [],
      slashCommands: [],
      mcpToolNames: [],
    };

    const result = buildProjectVocab(snapshot);

    expect(result.protected.has('the')).toBe(true);
    expect(result.targets.has('the')).toBe(false);
  });

  it('includes raw slash commands verbatim in protected', () => {
    const snapshot: VocabSnapshot = {
      sessionNames: [],
      docNames: [],
      todoTitles: [],
      fileSegments: [],
      slashCommands: ['/collab'],
      mcpToolNames: [],
    };

    const result = buildProjectVocab(snapshot);

    expect(result.protected.has('/collab')).toBe(true);
  });
});
