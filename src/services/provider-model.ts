import type { NodeProvider } from './node-provider';

export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const;
/** grok CLI proxy (OIDC lane) serves ONLY `grok-4.5` as of CLI v0.2.93 — run in build/agentic
 *  mode (telemetry: `grok-4.5-build`). The prior slugs are kept as accepted-but-legacy values so
 *  a stale override row still validates; grok-model.ts aliases them all onto `grok-4.5` at spawn. */
export const GROK_BUILD_MODELS = ['grok-4.5', 'grok-build', 'grok-build-0.1', 'grok-composer-2.5-fast', 'composer-2.5'] as const;
/** api.x.ai ids — the CLI rejects these; reached only via the read-only XaiApiNodeInvoker. */
export const GROK_API_MODELS = ['grok-4.3', 'grok-4.5', 'grok-4.6', 'grok-build-0.1'] as const;

export const PROVIDER_MODELS: Record<NodeProvider, readonly string[]> = {
  claude: CLAUDE_MODELS,
  'grok-build': GROK_BUILD_MODELS,
  'grok-api': GROK_API_MODELS,
};

export function isModelForProvider(provider: NodeProvider, model: string): boolean {
  return PROVIDER_MODELS[provider].includes(model);
}

/** null when ok; an ACTIONABLE message naming BOTH sides when not. */
export function providerModelMismatch(provider: NodeProvider, model: string | null | undefined): string | null {
  if (!model || model.trim() === '') return null;

  const models = PROVIDER_MODELS[provider];
  if (isModelForProvider(provider, model)) return null;

  // Find which provider this model actually belongs to
  let actualProvider: NodeProvider | null = null;
  for (const p of Object.keys(PROVIDER_MODELS) as NodeProvider[]) {
    if (isModelForProvider(p, model)) {
      actualProvider = p;
      break;
    }
  }

  const actualText = actualProvider
    ? ` '${model}' is a ${actualProvider} model.`
    : '';
  return `model '${model}' does not belong to provider '${provider}' (${provider} models: ${models.join(', ')}).${actualText}`;
}
