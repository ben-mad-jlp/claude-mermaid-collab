// Escalation taxonomy mirrors backend kind constants:
// TOKEN_BURN_KIND (src/services/burn-watch.ts:26)
// CRITERION_SERVE_CAP_KIND (src/services/conductor-pass.ts:42)
// DANGLING_DEPS_KIND (src/services/reconcile-pass.ts:47)
// 'epic-ready-to-land' (src/services/coordinator-land.ts:571)
// 'poison-loop-cap' / 'reserve-leaf' (src/services/reserve-leaf.ts:183,195,253)
// These constants are not importable from ui/ — values are duplicated string literals.

export type EscalationResolver =
  | 'bridge-land'
  | 'bridge-escalation'
  | 'reset-override'
  | 'token-burn-ack'
  | 'decision-or-reset'
  | 'decision-or-reset-ack';

export interface EscalationTaxonomyEntry {
  kind: string;
  groupTitle: string;
  resolver: EscalationResolver;
}

export const GROUP_TITLES = {
  landReady: 'Ready to Land',
  poisonOrReserve: 'Poison Loop / Reserve',
  tokenBurn: 'Token Burn',
  serveCap: 'Criterion Serve Cap',
  danglingDeps: 'Dangling Dependencies',
  other: 'Other Escalations',
} as const;

export const ESCALATION_TAXONOMY: EscalationTaxonomyEntry[] = [
  { kind: 'epic-ready-to-land', groupTitle: GROUP_TITLES.landReady, resolver: 'bridge-land' },
  { kind: 'poison-loop-cap', groupTitle: GROUP_TITLES.poisonOrReserve, resolver: 'reset-override' },
  { kind: 'reserve-leaf', groupTitle: GROUP_TITLES.poisonOrReserve, resolver: 'reset-override' },
  { kind: 'token-burn', groupTitle: GROUP_TITLES.tokenBurn, resolver: 'token-burn-ack' },
  { kind: 'criterion-serve-cap', groupTitle: GROUP_TITLES.serveCap, resolver: 'decision-or-reset-ack' },
  { kind: 'dangling-deps', groupTitle: GROUP_TITLES.danglingDeps, resolver: 'decision-or-reset' },
  { kind: 'blocker', groupTitle: GROUP_TITLES.other, resolver: 'bridge-escalation' },
];

const DEFAULT_ENTRY: EscalationTaxonomyEntry = {
  kind: '*',
  groupTitle: GROUP_TITLES.other,
  resolver: 'bridge-escalation',
};

export function taxonomyEntryForKind(kind: string): EscalationTaxonomyEntry {
  return ESCALATION_TAXONOMY.find((t) => t.kind === kind) ?? DEFAULT_ENTRY;
}
