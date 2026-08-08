import { describe, it, expect } from 'bun:test';
import { buildNodePrompt, type BallotPromptRequirement } from '../leaf-prompts';
import { EXPLORE_REPORT_SENTINEL } from '../todo-store';
import type { Todo } from '../todo-store';
import type { ExploreSpec } from '../todo-store';

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

describe('buildNodePrompt explore node', () => {
  const exploreSpec: ExploreSpec = {
    scope: 'Check for dead-code references to deprecated symbol X',
    target: 'src/services/foo.ts exports X; grep for all callers',
    oracle: 'If zero callers found, X is safe to delete',
  };

  it('buildNodePrompt explore includes spec fields, sentinel, zero-findings success, and no Write instruction', () => {
    const leaf = { id: 'explore-1', exploreSpec } as unknown as Todo;
    const prompt = buildNodePrompt('explore', leaf);

    // Assert spec fields are present
    expect(prompt).toContain('Scope: Check for dead-code references to deprecated symbol X');
    expect(prompt).toContain('Target: src/services/foo.ts exports X; grep for all callers');
    expect(prompt).toContain('Oracle: If zero callers found, X is safe to delete');

    // Assert sentinel is interpolated (not re-typed as literal string)
    expect(prompt).toContain(`${EXPLORE_REPORT_SENTINEL}: FINDINGS=`);

    // Assert zero-findings success is stated
    expect(prompt).toContain('Finding NOTHING is a valid, successful exploration');
    expect(prompt).toContain('even with zero findings');

    // Assert READ-ONLY constraint and no Write instruction
    expect(prompt).toContain('READ-ONLY investigation');
    expect(prompt).toContain('You MUST NOT Write or edit any file');
    expect(prompt).toContain('the EXECUTOR writes and commits the report');
  });
});
