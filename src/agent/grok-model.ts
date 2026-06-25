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
  'summary',
] as const;

export type GrokNodeKind = (typeof GROK_NODE_KINDS)[number];

const REASONING_KINDS = new Set<GrokNodeKind>(['blueprint', 'review', 'driveplan']);

/** UI / config value → `grok -m` CLI id. */
export const GROK_MODEL_ALIASES: Record<string, string> = {
  'grok-build': 'grok-build-0.1',
  'grok-build-0.1': 'grok-build-0.1',
  'grok-composer-2.5-fast': 'grok-composer-2.5-fast',
};

const CLAUDE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

/** Floor: 'blueprint'. Waves: 'wimplement:src/foo.ts' → 'wimplement'. */
export function parseKindFromTranscriptLabel(label?: string): GrokNodeKind | undefined {
  if (!label) return undefined;
  const kind = label.split(':')[0];
  if (!(GROK_NODE_KINDS as readonly string[]).includes(kind)) return undefined;
  return kind as GrokNodeKind;
}

export function kindDefaultGrokModel(kind?: GrokNodeKind): string {
  if (kind && REASONING_KINDS.has(kind)) return 'grok-build-0.1';
  return 'grok-composer-2.5-fast';
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