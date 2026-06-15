/**
 * Per-phase tool capabilities — the discipline's read-only invariant made STRUCTURAL.
 *
 * The recipe (design-grok-worker-discipline §2.2) requires that research / verify /
 * review / sizegate are PHYSICALLY incapable of mutating the worktree — they get
 * read-only tools only; the implement phase is the sole writer. Encoding that here
 * (not in a prompt) is what makes "verify is independent of implement" a structural
 * guarantee rather than a hope. A misconfiguration throws, loudly, at build time.
 */

export type SubloopRole = 'sizegate' | 'research' | 'implement' | 'verify' | 'review';

export type ToolName =
  | 'read_file'
  | 'grep'
  | 'glob'
  | 'run_bash_ro'
  | 'get_diagram'
  | 'create_diagram'
  | 'write_file'
  | 'edit'
  | 'run_bash';

/** Whether a tool can mutate the worktree (the isolation-relevant capability).
 *  NOTE: create_diagram writes the collab design store, NOT the git worktree, so it
 *  is NOT tree-mutating and is safe for the read-only research phase. */
export const TOOL_MUTATES_TREE: Record<ToolName, boolean> = {
  read_file: false,
  grep: false,
  glob: false,
  run_bash_ro: false,
  get_diagram: false,
  create_diagram: false,
  write_file: true,
  edit: true,
  run_bash: true,
};

const READONLY_ROLES = new Set<SubloopRole>(['sizegate', 'research', 'verify', 'review']);

export function isReadOnlyRole(role: SubloopRole): boolean {
  return READONLY_ROLES.has(role);
}

/** The tools each phase is granted. Read-only phases declare ONLY non-mutating
 *  tools; implement is the sole writer. Validated by resolveRoleTools below. */
export const ROLE_TOOLS: Record<SubloopRole, ToolName[]> = {
  sizegate: ['read_file', 'grep', 'glob', 'run_bash_ro'],
  research: ['read_file', 'grep', 'glob', 'run_bash_ro', 'create_diagram', 'get_diagram'],
  implement: ['read_file', 'grep', 'glob', 'write_file', 'edit', 'run_bash'],
  verify: ['read_file', 'grep', 'glob', 'run_bash_ro', 'get_diagram'],
  review: ['read_file', 'grep', 'glob', 'run_bash_ro', 'get_diagram'],
};

/** Throw if a read-only role is granted any tree-mutating tool. */
export function assertRoleCapable(role: SubloopRole, names: ToolName[]): void {
  if (!isReadOnlyRole(role)) return;
  const bad = names.filter((n) => TOOL_MUTATES_TREE[n]);
  if (bad.length > 0) {
    throw new Error(`read-only role '${role}' must not receive tree-mutating tools: ${bad.join(', ')}`);
  }
}

/** Resolve the validated toolset for a phase. Throws if the declared set violates
 *  the read-only invariant — a structural guard, not a prompt instruction. */
export function resolveRoleTools(role: SubloopRole): ToolName[] {
  const names = ROLE_TOOLS[role];
  assertRoleCapable(role, names);
  return names;
}
