/**
 * resolveModel — the multi-provider seam: (ProviderId, modelId) → AI SDK LanguageModel.
 *
 * This is the ONE place a model is constructed. The worker-core state machine never
 * names a provider SDK; it calls resolveModel, so swapping grok → codex → anthropic
 * is a config change, never a control-flow change (north-star: provider swap is
 * permanent). Today only `grok-build` (via @ai-sdk/xai, installed) is wired;
 * `claude` / `codex` are explicit throw-stubs until their SDKs are added — adding a
 * provider is: install its @ai-sdk/* package + add one `case`.
 *
 * (Built correctly here after the bakeoff caught grok-build hardcoding xai() +
 * drifting on model ids — see bakeoff-phase1-blueprints.)
 */
import { xai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';
import type { ProviderId } from '../worker-agent';

/** Per-provider default model when a phase doesn't pin one. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  'grok-build': 'grok-build-0.1',
  claude: 'claude-sonnet-4-6',
  codex: 'gpt-5-codex',
};

export function resolveModel(provider: ProviderId, modelId?: string): LanguageModel {
  const id = modelId ?? DEFAULT_MODEL_BY_PROVIDER[provider];
  switch (provider) {
    case 'grok-build':
      return xai(id);
    case 'claude':
    case 'codex':
      throw new Error(
        `worker-core resolveModel: provider '${provider}' is not wired in-process yet ` +
          `(only 'grok-build' via @ai-sdk/xai is installed; add its @ai-sdk SDK + a case to enable)`,
      );
    default: {
      // Exhaustiveness: a new ProviderId must add a case above or this fails to compile.
      const _exhaustive: never = provider;
      throw new Error(`worker-core resolveModel: unknown provider '${String(_exhaustive)}'`);
    }
  }
}
