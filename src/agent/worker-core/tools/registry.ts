/**
 * Tool registry — wires the worktree ops into AI-SDK `tool()` defs, capability-gated
 * per phase. `buildToolset(role, ctx)` returns ONLY the tools that role is allowed
 * (resolveRoleTools enforces the read-only invariant) AND that are wired today.
 *
 * Wired now: read_file / write_file / edit / run_bash / run_bash_ro / grep / glob, plus
 * create_diagram / get_diagram (diagram-as-spec) when a project+session is supplied —
 * those use the in-process collab funnel, NOT the MCP HTTP helper.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { resolveRoleTools, type SubloopRole, type ToolName } from '../capabilities';
import { readFileOp, writeFileOp, editFileOp } from './fs-ops';
import { bashOp } from './bash-ops';
import { grepOp, globOp } from './search';

export interface ToolCtx {
  /** The lane's worktree root — every tool is scoped under it. */
  cwd: string;
  /** The run's collab project + session — required for the diagram-as-spec tools
   *  (create_diagram / get_diagram). When absent, those tools are skipped. */
  project?: string;
  session?: string;
}

type Factory = (ctx: ToolCtx) => Tool;

const FACTORIES: Partial<Record<ToolName, Factory>> = {
  read_file: (ctx) =>
    tool({
      description: 'Read a file (path relative to the worktree), line-numbered + paginated.',
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().int().optional(),
        limit: z.number().int().optional(),
      }),
      execute: async ({ path, offset, limit }) => JSON.stringify(readFileOp(ctx.cwd, path, { offset, limit })),
    }),
  write_file: (ctx) =>
    tool({
      description: 'Write a file (relative to the worktree). Creates parents; overwrites.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => JSON.stringify(writeFileOp(ctx.cwd, path, content)),
    }),
  edit: (ctx) =>
    tool({
      description: 'Edit a file by exact string replacement (fuzzy-cascade matched; ambiguous match is refused, never guessed).',
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async ({ path, oldString, newString, replaceAll }) =>
        JSON.stringify(editFileOp(ctx.cwd, path, oldString, newString, replaceAll ?? false)),
    }),
  run_bash: (ctx) =>
    tool({
      description: 'Run a bash command in the worktree (relative paths; no absolute cd).',
      inputSchema: z.object({ cmd: z.string() }),
      execute: async ({ cmd }) => JSON.stringify(bashOp(ctx.cwd, cmd)),
    }),
  run_bash_ro: (ctx) =>
    tool({
      description: 'Run a READ-ONLY bash command in the worktree (obvious mutators are blocked).',
      inputSchema: z.object({ cmd: z.string() }),
      execute: async ({ cmd }) => JSON.stringify(bashOp(ctx.cwd, cmd, { readOnly: true })),
    }),
  grep: (ctx) =>
    tool({
      description: 'Search file contents in the worktree by regex (optionally restricted to a glob).',
      inputSchema: z.object({ pattern: z.string(), glob: z.string().optional() }),
      execute: async ({ pattern, glob }) => JSON.stringify(grepOp(ctx.cwd, pattern, { glob })),
    }),
  glob: (ctx) =>
    tool({
      description: 'List worktree files whose path matches a glob (** across dirs, * within a segment).',
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => JSON.stringify(globOp(ctx.cwd, pattern)),
    }),
  create_diagram: (ctx) =>
    tool({
      description:
        'Create a Mermaid diagram in the collab session — use this in research to post a before/after DIAGRAM-AS-SPEC (the behavioral contract verify/review will judge against). Returns the diagram id; include that id in your findings.',
      inputSchema: z.object({ name: z.string(), content: z.string() }),
      execute: async ({ name, content }) => {
        const { createWorkerDiagram } = await import('../../../services/worker-collab-funnel');
        const id = await createWorkerDiagram(ctx.project!, ctx.session!, name, content);
        return JSON.stringify({ id, name });
      },
    }),
  get_diagram: (ctx) =>
    tool({
      description: 'Read a collab diagram by id (e.g. the diagram-as-spec from research) — the contract to check the change-set against.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const { getWorkerDiagram } = await import('../../../services/worker-collab-funnel');
        const d = await getWorkerDiagram(ctx.project!, ctx.session!, id);
        return d ? JSON.stringify(d) : '(diagram not found)';
      },
    }),
};

/** Tool names with a wired factory today. */
export const WIRED_TOOLS = Object.keys(FACTORIES) as ToolName[];

/** Build the capability-gated toolset for a phase. Throws if the role declares a
 *  mutating tool while read-only (structural guard); skips not-yet-wired tools. */
export function buildToolset(role: SubloopRole, ctx: ToolCtx): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  const hasCollab = !!(ctx.project && ctx.session);
  for (const name of resolveRoleTools(role)) {
    // Diagram tools need a collab project+session; skip them when running without one
    // (e.g. unit tests / a worktree-only run) — the rest of the toolset is unaffected.
    if ((name === 'create_diagram' || name === 'get_diagram') && !hasCollab) continue;
    const factory = FACTORIES[name];
    if (factory) out[name] = factory(ctx);
  }
  return out;
}
