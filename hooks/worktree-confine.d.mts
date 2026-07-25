/** Type declarations for the worktree-confinement PreToolUse hook's pure exports
 *  (see worktree-confine.mjs). Lets the TS test suite import the .mjs with types. */

export interface HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    command?: string;
    [k: string]: unknown;
  };
}

/** Raw hook input from either grok or claude dialect (both snake_case and camelCase). */
export interface RawHookInput {
  tool_name?: string;
  toolName?: string;
  tool_input?: {
    file_path?: string;
    path?: string;
    abs_path?: string;
    target_file?: string;
    notebook_path?: string;
    target_notebook?: string;
    command?: string;
    [k: string]: unknown;
  };
  toolInput?: {
    file_path?: string;
    path?: string;
    abs_path?: string;
    target_file?: string;
    notebook_path?: string;
    target_notebook?: string;
    command?: string;
    [k: string]: unknown;
  };
}

export type Decision = { deny: false } | { deny: true; reason: string };

/** Canonicalise a path that may not yet exist (resolve `..` + realpath existing ancestor). */
export function canonicalize(p: string): string;

/** Is `child` the same as, or nested under, `parent`? Both must already be canonical. */
export function isInside(child: string, parent: string): boolean;

/** Absolute `cd`/`pushd` targets in a shell command that escape the (canonical) worktree. */
export function findCdEscapes(command: unknown, canonWorktree: string): string[];

/** Pure containment decision for a PreToolUse call against the worktree boundary. */
export function decide(input: HookInput | null | undefined, worktree: string | undefined): Decision;

/** Normalize hook input from both grok and claude dialects into a common shape. */
export function normalizeHookInput(raw: unknown): HookInput;

/** Build a deny response object for both grok and claude hooks. */
export function buildDenyOutput(reason: string): {
  decision: 'deny';
  reason: string;
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
};
