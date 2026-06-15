/**
 * Tool registry — wires the worktree ops into AI-SDK `tool()` defs, capability-gated
 * per phase. `buildToolset(role, ctx)` returns ONLY the tools that role is allowed
 * (resolveRoleTools enforces the read-only invariant) AND that are wired today.
 *
 * Wired now: read_file / write_file / edit / run_bash / run_bash_ro. Pending (skipped
 * silently — the model can grep via run_bash meanwhile): grep / glob (need the rg
 * wrapper) and create_diagram / get_diagram (need the in-process collab funnel).
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { resolveRoleTools, type SubloopRole, type ToolName } from '../capabilities';
import { readFileOp, writeFileOp, editFileOp } from './fs-ops';
import { bashOp } from './bash-ops';

export interface ToolCtx {
  /** The lane's worktree root — every tool is scoped under it. */
  cwd: string;
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
};

/** Tool names with a wired factory today. */
export const WIRED_TOOLS = Object.keys(FACTORIES) as ToolName[];

/** Build the capability-gated toolset for a phase. Throws if the role declares a
 *  mutating tool while read-only (structural guard); skips not-yet-wired tools. */
export function buildToolset(role: SubloopRole, ctx: ToolCtx): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const name of resolveRoleTools(role)) {
    const factory = FACTORIES[name];
    if (factory) out[name] = factory(ctx);
  }
  return out;
}
