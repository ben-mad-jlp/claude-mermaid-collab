/**
 * mutation_probe — MCP wiring for the mutation probe engine.
 *
 * Runs a three-arm probe (control/neutered/throw) in a disposable worktree
 * to determine whether a symbol is called and whether its execution is observed.
 * Returns the execution-signal verdict and full probe result.
 */
import { runMutationProbe } from '../../services/mutation-probe.js';

export const mutationProbeToolDef = {
  name: 'mutation_probe',
  description: 'Run the three-arm mutation probe (control/neutered/throw) in a disposable worktree to determine if a symbol is called and whether its execution is observed. Returns execution-signal verdict (never-called, called-observed, called-unobserved, or indeterminate) and full probe result.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Tracking project (filesystem repo root where the work-graph lives).' },
      file: { type: 'string', description: 'Repo-relative path of the source file to probe.' },
      symbol: { type: 'string', description: 'Exported symbol name to neuter/throw-probe.' },
      testCommand: { type: 'string', description: 'Test invocation to run per arm (e.g., "bun test src/example.test.ts").' },
      timeoutMs: { type: 'number', description: 'Optional: accepted for forward-compat (not passed to runMutationProbe).' },
    },
    required: ['project', 'file', 'symbol', 'testCommand'],
  },
};

export async function mutationProbeHandler(args: any): Promise<string> {
  const { project, file, symbol, testCommand, timeoutMs } = args as {
    project?: string;
    file?: string;
    symbol?: string;
    testCommand?: string;
    timeoutMs?: number;
  };

  const missing: string[] = [];
  if (!project) missing.push('project');
  if (!file) missing.push('file');
  if (!symbol) missing.push('symbol');
  if (!testCommand) missing.push('testCommand');

  if (missing.length > 0) {
    throw new Error(`Missing required: ${missing.join(', ')}`);
  }

  const result = await runMutationProbe({
    project: project!,
    repo: project!,
    file: file!,
    symbol: symbol!,
    testCommand: testCommand!,
  });

  return JSON.stringify(result, null, 2);
}
