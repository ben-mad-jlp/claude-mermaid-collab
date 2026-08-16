import { describe, test, expect } from 'bun:test';
import { buildDerivePrompt, deriveProbeSet, type DeriveResult } from '../campaign-derive.ts';
import { validateCampaign, type ProbeForgeInput } from '../campaign-validate.ts';
import type { JudgmentLLM } from '../judgment-llm.ts';

/**
 * Hand-rolled fake JudgmentLLM for testing. Canned replies are configured
 * per test; no DB, no actual LLM calls.
 */
function makeFakeJudgmentLLM(cannedReply: string): JudgmentLLM {
  return {
    async complete(system: string, user: string): Promise<string> {
      return cannedReply;
    },
  };
}

describe('campaign-derive', () => {
  test('concrete goal yields probes that pass validateCampaign', async () => {
    const goal = 'Verify that the test suite passes on the current commit';
    const cannedReply = JSON.stringify({
      probes: [
        {
          ref: 'build-tests',
          kind: 'command',
          environment: 'worktree',
          command: 'bun test',
          asserts: 'All tests pass',
        },
        {
          ref: 'check-types',
          kind: 'command',
          environment: 'worktree',
          command: 'npx tsc --noEmit',
          dependsOn: ['build-tests'],
          asserts: 'No type errors',
        },
      ],
    });

    const llm = makeFakeJudgmentLLM(cannedReply);
    const result = await deriveProbeSet(goal, { llm });

    expect(result.kind).toBe('probes');
    if (result.kind === 'probes') {
      expect(result.probes.length).toBe(2);
      expect(result.probes[0].ref).toBe('build-tests');
      expect(result.probes[1].ref).toBe('check-types');
      expect(result.probes[1].dependsOn).toContain('build-tests');

      // Verify that the probes pass validateCampaign.
      const validation = validateCampaign({
        title: goal,
        goal,
        probes: result.probes,
      });
      expect(validation.ok).toBe(true);
    }
  });

  test('ambiguous goal reply yields a non-empty questions list', async () => {
    const goal = 'Improve the system';
    const cannedReply = JSON.stringify({
      questions: [
        'What aspect of the system should we improve?',
        'What is the target metric?',
        'Who is the intended user?',
      ],
    });

    const llm = makeFakeJudgmentLLM(cannedReply);
    const result = await deriveProbeSet(goal, { llm });

    expect(result.kind).toBe('questions');
    if (result.kind === 'questions') {
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.questions[0]).toContain('aspect');
    }
  });

  test('empty reply yields questions never zero probes', async () => {
    const goal = 'Verify something';
    const llm = makeFakeJudgmentLLM('');

    const result = await deriveProbeSet(goal, { llm });

    expect(result.kind).toBe('questions');
    if (result.kind === 'questions') {
      expect(result.questions.length).toBeGreaterThan(0);
    }
  });

  test('garbage reply yields questions never zero probes', async () => {
    const goal = 'Verify something';
    const llm = makeFakeJudgmentLLM('This is just prose with no JSON anywhere');

    const result = await deriveProbeSet(goal, { llm });

    expect(result.kind).toBe('questions');
    if (result.kind === 'questions') {
      expect(result.questions.length).toBeGreaterThan(0);
    }
  });

  test('probes that fail validateCampaign fall to the questions arm', async () => {
    const goal = 'Run a docker container';
    // Invalid environment 'docker' (not in the closed union ['worktree', 'rig']).
    const cannedReply = JSON.stringify({
      probes: [
        {
          ref: 'run-docker',
          kind: 'command',
          environment: 'docker',
          command: 'docker run ...',
        },
      ],
    });

    const llm = makeFakeJudgmentLLM(cannedReply);
    const result = await deriveProbeSet(goal, { llm });

    // Should fall to the questions arm because 'docker' is not a valid environment.
    expect(result.kind).toBe('questions');
    if (result.kind === 'questions') {
      expect(result.questions.length).toBeGreaterThan(0);
      // The fallback question should mention validation errors.
      expect(result.questions[0]).toContain('validation');
    }
  });

  test('derive prompt names both arms and the closed environment union', () => {
    const goal = 'Verify the build succeeds';
    const { system, user } = buildDerivePrompt(goal);

    // System prompt should name both arms.
    expect(system).toContain('probes');
    expect(system).toContain('questions');

    // System prompt should name the two-arm rule: WHAT vs HOW.
    expect(system).toContain('worktree');
    expect(system).toContain('rig');

    // User prompt should embed the goal verbatim.
    expect(user).toContain(goal);
  });
});
