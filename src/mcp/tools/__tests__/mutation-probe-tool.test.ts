import { describe, it, expect } from 'bun:test';
import { mutationProbeHandler } from '../mutation-probe.js';

describe('mutationProbeHandler', () => {
  it('rejects a call missing symbol with an error naming it', async () => {
    const args = {
      project: '/tmp/test-project',
      file: 'src/example.ts',
      testCommand: 'exit 0',
      // symbol is intentionally omitted
    };

    try {
      await mutationProbeHandler(args);
      throw new Error('Expected handler to throw');
    } catch (err: any) {
      expect(err.message).toContain('symbol');
    }
  });

  it('a successful call\'s parsed JSON has control, neutered and execution keys', async () => {
    // Use the existing fixture from the mutation-probe service tests.
    // The fixture path is relative to the repo root.
    const project = import.meta.dir + '/../../../../services/__fixtures__/mutation-probe';
    const file = 'observed-subject.ts';
    const symbol = 'observedSubject';
    const testCommand = 'exit 0'; // A trivially-true command so the test doesn't require a real test suite.

    const result = await mutationProbeHandler({
      project,
      file,
      symbol,
      testCommand,
    });

    // Parse the JSON result
    const parsed = JSON.parse(result);

    // Verify the required keys are present
    expect(parsed).toHaveProperty('control');
    expect(parsed).toHaveProperty('neutered');
    expect(parsed).toHaveProperty('execution');

    // Verify the structure of the result
    expect(parsed.control).toHaveProperty('ran');
    expect(parsed.control).toHaveProperty('passed');
    expect(parsed.control).toHaveProperty('exitCode');
    expect(parsed.neutered).toHaveProperty('ran');
    expect(parsed.execution).toBeDefined();
  });
});
