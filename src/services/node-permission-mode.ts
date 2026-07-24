/**
 * The `--permission-mode` a leaf-executor node is spawned under — config-driven, so the
 * daemon can move OFF `bypassPermissions` (--dangerously-skip-permissions) toward a spec'd
 * sandbox WITHOUT a code redeploy, and roll back the same way if a node starts spuriously
 * denying a tool it legitimately needs.
 *
 * WHY A FLAG, NOT A HARDCODED FLIP. Under `bypassPermissions` every tool call is allowed;
 * under `dontAsk` a call NOT in the node's `--allowedTools` list is DENIED (proven on CLI
 * 2.1.219: --allowedTools doubles as the dontAsk allow-list, and an un-listed tool denies and
 * TERMINATES — no tty hang). That is the hardening we want, but it also denies CLI built-ins a
 * node might reach for that were silently allowed under bypass (TodoWrite, Task, WebFetch). So
 * the switch is rolled out as a reversible config value, flipped on the self-project first and
 * watched, not batch-deployed as a blind behavior change. See [[dontask-headless-permission-recipe]].
 *
 * Config key `MERMAID_NODE_PERMISSION_MODE` (env-first via getConfig): 'bypassPermissions'
 * (default, unchanged behavior) or 'dontAsk' (the spec'd sandbox). Any other value falls back
 * to the safe default — a typo must never silently pick a mode that hangs a tty-less child.
 */

import { getConfig } from './config-file';

export const NODE_PERMISSION_MODE_KEY = 'MERMAID_NODE_PERMISSION_MODE';

/** The two modes the daemon supports for a HEADLESS node. Both are non-hanging on our CLI:
 *  bypass allows everything; dontAsk denies-on-unmatched. The other CLI modes
 *  (manual/acceptEdits/plan) PROMPT on an un-approved call and would hang a tty-less child, so
 *  they are deliberately NOT selectable here. */
export type NodePermissionMode = 'bypassPermissions' | 'dontAsk';

const VALID: ReadonlySet<string> = new Set<NodePermissionMode>(['bypassPermissions', 'dontAsk']);

/** Resolve the node permission mode from config. Defaults to 'bypassPermissions' (current
 *  behavior). An unrecognised value logs once and falls back to the default — never to a
 *  prompting mode that would hang. Pure over getConfig; no I/O of its own. */
export function resolveNodePermissionMode(): NodePermissionMode {
  const raw = getConfig(NODE_PERMISSION_MODE_KEY, 'bypassPermissions');
  if (raw && VALID.has(raw)) return raw as NodePermissionMode;
  if (raw && raw !== 'bypassPermissions') {
    console.warn(
      `[node-permission-mode] ignoring unsupported ${NODE_PERMISSION_MODE_KEY}=${raw} — ` +
      `only 'bypassPermissions' or 'dontAsk' are non-hanging for a headless node; using bypassPermissions`,
    );
  }
  return 'bypassPermissions';
}
