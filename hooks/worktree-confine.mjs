#!/usr/bin/env node
/**
 * PreToolUse WORKTREE-CONFINEMENT hook (defense-in-depth on top of dontAsk + the grant
 * model). A leaf node runs `claude -p` inside its lane worktree; this hook makes it
 * STRUCTURALLY impossible for that node to WRITE files or RUN tests in the MAIN checkout
 * (or anywhere else outside its worktree). It closes the incident of 2026-07-24, where
 * build123d leaves cd'd into the main checkout, ran pytest there, and produced good-faith
 * false greens with EMPTY worktree diffs.
 *
 * Wiring: node-invoker.ts generates a --settings file registering this script as a
 * PreToolUse hook for `Bash|Write|Edit|MultiEdit|NotebookEdit`, and sets
 * MERMAID_LEAF_WORKTREE=<lane worktree> in the node's env (worktreeSpawnEnv).
 *
 * Contract (see {@link decide}):
 *   - MERMAID_LEAF_WORKTREE absent/empty  → ALLOW everything (not a confined node).
 *   - Write/Edit/MultiEdit/NotebookEdit   → DENY iff the (canonicalised) target path is
 *                                           NOT inside the worktree subtree.
 *   - Bash                                → DENY iff the command `cd`/`pushd`es to an
 *                                           ABSOLUTE path outside the worktree (a clear
 *                                           write/test-elsewhere escape). Conservative:
 *                                           relative cd, in-tree cd, reads, no-cd → ALLOW.
 *   - everything else                     → ALLOW.
 *
 * Grok dialect: grok CLI 0.2.93 emits hook payloads with the following schema (observed
 * 2026-07-25). Observed verbatim payloads:
 *   {"hookEventName":"pre_tool_use","sessionId":"…","cwd":"/private/tmp/probe","workspaceRoot":"/private/tmp/probe","timestamp":"2026-07-25T22:21:34Z","transcriptPath":"…/updates.jsonl","toolName":"run_terminal_command","toolUseId":"call-…-0","toolInput":{"command":"echo probe-shell","description":"Run echo probe-shell"},"toolInputTruncated":false,"permissionMode":"bypassPermissions"}
 *   {"…","toolName":"search_replace","toolInput":{"file_path":"/private/tmp/probe/target.txt","old_string":"hello","new_string":"goodbye"},"toolInputTruncated":false,"permissionMode":"bypassPermissions"}
 *   {"…","toolName":"write","toolInput":{"file_path":"/private/tmp/probe/fresh.txt","content":"banana\n"},"toolInputTruncated":false,"permissionMode":"bypassPermissions"}
 * The hook normalizes both grok and claude dialects before calling {@link decide}.
 * Environment inheritance is proven: the hook child receives MERMAID_LEAF_WORKTREE from
 * the parent process.
 *
 * FAIL-OPEN by construction: any error (bad JSON, unreadable env, exception) → ALLOW,
 * logged to stderr. A PreToolUse hook that PRINTS NOTHING and exits 0 defers to the
 * permission rules (= allow under dontAsk). It NEVER emits "ask" (that hangs a tty-less
 * child). A hook bug must never wedge the daemon — empirically, a hook that fails to
 * launch is also treated as allow by the CLI.
 *
 * Dependency-free (node/bun stdlib only) and fast (runs per tool call).
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Map grok tool names to claude tool names. Grok tool names established from `strings`
 * over the grok 0.2.93 binary (source-of-truth note for future readers). */
const GROK_TOOL_ALIASES = {
  run_terminal_command: 'Bash',
  search_replace: 'Write',
  write: 'Write',
  create_file: 'Write',
  edit_file: 'Write',
  edit_notebook: 'NotebookEdit',
  str_replace: 'Write',
  delete: 'Write',
  apply_patch: 'Write',
  edit: 'Write',
  bash: 'Bash',
  shell: 'Bash',
};

/** Ordered list of possible file path field names across grok and claude dialects. */
const WRITE_TARGET_ALIASES = ['file_path', 'path', 'abs_path', 'target_file', 'notebook_path', 'target_notebook', 'filePath', 'cmd'];

/**
 * Canonicalise a path that may NOT YET EXIST (a Write target's file is created AFTER the
 * PreToolUse check). Resolve `.` / `..`, then realpath the deepest EXISTING ancestor and
 * rejoin the non-existent tail — so symlinked ancestors (e.g. macOS /tmp → /private/tmp,
 * a symlinked worktree root) resolve consistently on BOTH the target and the worktree.
 */
export function canonicalize(p) {
  let abs = resolve(p);
  const tail = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs; // hit the root; nothing on this path exists
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

/** Is `child` the same as, or nested under, `parent`? Both must already be canonical. */
export function isInside(child, parent) {
  if (child === parent) return true;
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

/** Expand a leading `~` / `~/…` to the home directory. Leaves other paths untouched. */
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Normalize hook input from both grok and claude dialects into a common shape.
 * Returns { tool_name, tool_input } that decide() expects.
 * Never throws — malformed inputs fall back to allow-shaped outputs.
 */
export function normalizeHookInput(raw) {
  // Garbage or non-object → fail-open
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { tool_name: undefined, tool_input: {} };
  }

  // Normalize tool name: grok uses camelCase (toolName), claude uses snake_case (tool_name)
  let tool_name = raw.tool_name ?? raw.toolName;
  if (typeof tool_name !== 'string') {
    return { tool_name: undefined, tool_input: {} };
  }

  // Apply grok → claude alias mapping
  tool_name = GROK_TOOL_ALIASES[tool_name] ?? tool_name;

  // Normalize tool input: grok uses camelCase (toolInput), claude uses snake_case (tool_input)
  let tool_input = raw.tool_input ?? raw.toolInput;
  if (typeof tool_input !== 'object' || tool_input === null || Array.isArray(tool_input)) {
    tool_input = {};
  }

  // If this is a write tool and file_path/notebook_path is missing, copy the first present
  // path-like field onto file_path. Do this on a shallow copy to never mutate raw.
  if (WRITE_TOOLS.has(tool_name) && !tool_input.file_path && !tool_input.notebook_path) {
    for (const alias of WRITE_TARGET_ALIASES) {
      if (typeof tool_input[alias] === 'string') {
        // Shallow copy and assign
        tool_input = { ...tool_input, file_path: tool_input[alias] };
        break;
      }
    }
  }

  return { tool_name, tool_input };
}

/**
 * Build a deny response object that works for both grok and claude hooks.
 * Grok expects `{ decision, reason }` and optionally `hookSpecificOutput.permissionDecision`.
 */
export function buildDenyOutput(reason) {
  return {
    decision: 'deny',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Find `cd`/`pushd` targets in a shell command that are ABSOLUTE paths escaping the
 * worktree. CONSERVATIVE: the cd/pushd must sit at a command position (line start or right
 * after a shell separator `; & | ( { \n` or a backtick) so `echo "cd /etc"` (cd inside a
 * quoted string, preceded by `"`) is NOT matched; and the argument must be a literal
 * absolute path (`/…` or `~…`) so `cd "$HOME"` / `cd relative` are NOT matched. Returns the
 * list of escaping (canonical) targets — empty means no clear absolute escape.
 */
export function findCdEscapes(command, canonWorktree) {
  if (typeof command !== 'string' || !command) return [];
  const re = /(?:^|[;&|(){}`\n])\s*(?:cd|pushd)\b\s+(['"]?)((?:\/|~)[^'"\s;&|)]*)\1/g;
  const escapes = [];
  let m;
  while ((m = re.exec(command)) !== null) {
    const raw = expandHome(m[2]);
    const canon = canonicalize(raw);
    if (!isInside(canon, canonWorktree)) escapes.push(canon);
  }
  return escapes;
}

/**
 * Pure containment decision. `input` = { tool_name, tool_input }, `worktree` = the value of
 * MERMAID_LEAF_WORKTREE (may be undefined). Returns { deny:false } to ALLOW, or
 * { deny:true, reason } to DENY. Never throws for ordinary inputs.
 */
export function decide(input, worktree) {
  // Unset boundary = "not a confined leaf node" → allow everything (never a blanket deny).
  if (!worktree || typeof worktree !== 'string' || !worktree.trim()) return { deny: false };
  const canonWt = canonicalize(worktree.trim());

  const tool = input && input.tool_name;
  const ti = (input && input.tool_input) || {};

  if (WRITE_TOOLS.has(tool)) {
    const target = typeof ti.file_path === 'string' ? ti.file_path
      : typeof ti.notebook_path === 'string' ? ti.notebook_path
      : undefined;
    if (!target) return { deny: false }; // nothing evaluable → fail-open
    const abs = isAbsolute(target) ? target : join(canonWt, target);
    const canonTarget = canonicalize(abs);
    if (isInside(canonTarget, canonWt)) return { deny: false };
    return {
      deny: true,
      reason:
        `worktree-confine: ${tool} target '${canonTarget}' is OUTSIDE this leaf's worktree ` +
        `'${canonWt}'. A leaf node may only write inside its own lane worktree — writing to ` +
        `the main checkout (or elsewhere) produces false greens with empty worktree diffs. ` +
        `Use a path inside the worktree.`,
    };
  }

  if (tool === 'Bash') {
    const escapes = findCdEscapes(ti.command, canonWt);
    if (escapes.length === 0) return { deny: false };
    return {
      deny: true,
      reason:
        `worktree-confine: Bash command cd/pushd's to ${escapes.map((e) => `'${e}'`).join(', ')}, ` +
        `OUTSIDE this leaf's worktree '${canonWt}'. Running builds/tests outside the worktree ` +
        `produces false greens with empty worktree diffs. Stay inside the worktree ` +
        `(cd into the worktree or use relative paths).`,
    };
  }

  return { deny: false };
}

/** Read all of stdin as a string. */
async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch (e) {
    // Malformed stdin → FAIL OPEN (allow). Log to stderr (non-fatal, shown in transcript).
    process.stderr.write(`[worktree-confine] allow (unparseable hook input): ${e}\n`);
    return;
  }
  let result;
  try {
    result = decide(normalizeHookInput(input), process.env.MERMAID_LEAF_WORKTREE);
  } catch (e) {
    process.stderr.write(`[worktree-confine] allow (decision error): ${e}\n`);
    return; // FAIL OPEN
  }
  if (result && result.deny) {
    process.stdout.write(JSON.stringify(buildDenyOutput(result.reason)) + '\n');
  }
  // else: print nothing → defer to permission rules (allow under dontAsk).
}

// Run main() only when executed as a script, not when imported by tests.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (e) => {
      // Absolute last resort: still fail open.
      process.stderr.write(`[worktree-confine] allow (top-level error): ${e}\n`);
      process.exit(0);
    },
  );
}
