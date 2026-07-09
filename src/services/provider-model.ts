import type { NodeProvider } from './node-provider';

export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const;
/** grok CLI proxy serves ONLY these coding models (memory: reference_grok_models_cli_vs_api). */
export const GROK_BUILD_MODELS = ['grok-build', 'grok-build-0.1', 'grok-composer-2.5-fast', 'composer-2.5'] as const;
/** api.x.ai ids — the CLI rejects these. */
export const GROK_API_MODELS = ['grok-4.3'] as const;

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
