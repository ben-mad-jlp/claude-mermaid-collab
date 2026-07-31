import { describe, it, expect } from 'bun:test';
import { buildNodePrompt, type BallotPromptRequirement } from '../leaf-prompts';
import type { Todo } from '../todo-store';

describe('buildNodePrompt review ballot preservation guidance', () => {
  const leaf = { id: 'leaf-1', title: 'a leaf', description: 'do the thing' } as unknown as Todo;

  it('includes the preservation ballot instruction when ballotRequirements is non-empty', () => {
    const ballot: BallotPromptRequirement[] = [
      { id: 'seal-stays-fail-open', kind: 'invariant', text: 'seal stays fail-open' },
    ];
    const prompt = buildNodePrompt('review', leaf, undefined, undefined, undefined, ballot);
    expect(prompt).toContain('PRESERVATION/invariant requirement');
    expect(prompt).toContain('never the unchanged production subject');
  });

  it('omits the preservation ballot instruction and TYPED REQUIREMENT BALLOT header when ballotRequirements is omitted or empty', () => {
    const promptOmitted = buildNodePrompt('review', leaf);
    const promptEmpty = buildNodePrompt('review', leaf, undefined, undefined, undefined, []);
    for (const prompt of [promptOmitted, promptEmpty]) {
      expect(prompt).not.toContain('PRESERVATION/invariant requirement');
      expect(prompt).not.toContain('never the unchanged production subject');
      expect(prompt).not.toContain('TYPED REQUIREMENT BALLOT');
    }
  });
});
