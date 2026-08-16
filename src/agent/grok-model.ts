/**
 * Grok CLI model resolution for headless daemon nodes (PR-1).
 *
 * UI / ledger store opaque ids (`grok-build`, `grok-composer-2.5-fast`); this module
 * maps them to the `grok -m` CLI id. Kind hints come from `NodeSpec.transcriptLabel`.
 */

/** Mirror of leaf-executor LEAF_NODE_KINDS — kept local to avoid import cycles. */
export const GROK_NODE_KINDS = [
  'blueprint', 'implement', 'review',
  'research', 'wimplement', 'verify', 'fix',
  'driveplan', 'driveexec', 'report',
  'lens', 'commander',
  'summary',
] as const;

export type GrokNodeKind = (typeof GROK_NODE_KINDS)[number];

/** UI / config value → `grok -m` CLI id. As of grok CLI v0.2.93 the whole prior lineup
 *  (`grok-build`, `grok-composer-2.5-fast`, `grok-build-0.1`) was retired from the CLI; `grok
 *  models` now serves a single id, `grok-4.5`, which the CLI runs in build/agentic-coding mode
 *  (telemetry reports it as `grok-4.5-build`). Every legacy slug is aliased onto it so a stored
 *  override row from the old lineup keeps resolving to a live CLI id. (grok-build-0.1 still
 *  exists on the api.x.ai developer platform — see xai-api-invoker.ts — but the CLI rejects it.) */
export const GROK_MODEL_ALIASES: Record<string, string> = {
  'grok-4.5': 'grok-4.5',
  'grok-build': 'grok-4.5', // legacy → live CLI id
  'grok-build-0.1': 'grok-4.5', // legacy CLI slug → live CLI id
  'grok-composer-2.5-fast': 'grok-4.5', // retired → live CLI id
  'composer-2.5': 'grok-4.5', // retired → live CLI id
};

const CLAUDE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

/** Floor: 'blueprint'. Waves: 'wimplement:src/foo.ts' → 'wimplement'. */
export function parseKindFromTranscriptLabel(label?: string): GrokNodeKind | undefined {
  if (!label) return undefined;
  const kind = label.split(':')[0];
  if (!(GROK_NODE_KINDS as readonly string[]).includes(kind)) return undefined;
  return kind as GrokNodeKind;
}

export function kindDefaultGrokModel(_kind?: GrokNodeKind): string {
  // The grok CLI exposes exactly one model now (`grok-4.5`, run in build mode); every kind
  // resolves to it. The kind arg is retained for signature stability + a future re-split.
  return 'grok-4.5';
}

/**
 * Resolve stored model override + kind hint → `grok -m` CLI id.
 * Contract A: called only inside `buildGrokArgv`, never for ledger display.
 */
export function resolveGrokModel(stored: string | undefined, kindHint?: string): string {
  const kind = parseKindFromTranscriptLabel(kindHint);
  const trimmed = stored?.trim();
  if (trimmed && !CLAUDE_ALIASES.has(trimmed)) {
    return GROK_MODEL_ALIASES[trimmed] ?? trimmed;
  }
  if (trimmed && CLAUDE_ALIASES.has(trimmed)) {
    // eslint-disable-next-line no-console
    console.warn(`resolveGrokModel: Claude alias '${trimmed}' on grok provider; using kind default`);
  }
  return kindDefaultGrokModel(kind);
}