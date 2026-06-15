/**
 * Asset-generation spend tracking + cost preview (game-asset toolkit, T3).
 *
 * A game means many paid Grok generations. This tracks cumulative session spend and an
 * optional budget cap, and estimates the cost of an operation BEFORE running it.
 * Persisted as one JSON per session: <project>/.collab/sessions/<session>/asset-spend.json
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export interface AssetSpend {
  /** Cumulative USD spent on asset generation this session. */
  totalUsd: number;
  /** Optional hard cap; generations are blocked once totalUsd would exceed it. */
  budgetUsd?: number;
  /** Per-op tallies for reporting. */
  byOp?: Record<string, { count: number; usd: number }>;
}

// Observed unit costs (USD). Image 1k≈$0.05 / 2k≈$0.07; video 8s≈$0.40; TTS $4.20/1M chars.
const COST = { image: 0.07, video: 0.40, tts_per_char: 4.2e-6 };

function spendPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'asset-spend.json');
}

export async function loadSpend(project: string, session: string): Promise<AssetSpend> {
  try {
    return JSON.parse(await readFile(spendPath(project, session), 'utf-8')) as AssetSpend;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { totalUsd: 0 };
    throw err;
  }
}

export async function setBudget(project: string, session: string, budgetUsd: number | null): Promise<AssetSpend> {
  const s = await loadSpend(project, session);
  if (budgetUsd == null) delete s.budgetUsd; else s.budgetUsd = budgetUsd;
  await persist(project, session, s);
  return s;
}

export async function recordSpend(project: string, session: string, usd: number, op = 'gen'): Promise<AssetSpend> {
  if (!usd || usd <= 0) return loadSpend(project, session);
  const s = await loadSpend(project, session);
  s.totalUsd = Math.round((s.totalUsd + usd) * 1e6) / 1e6;
  s.byOp = s.byOp ?? {};
  s.byOp[op] = { count: (s.byOp[op]?.count ?? 0) + 1, usd: Math.round(((s.byOp[op]?.usd ?? 0) + usd) * 1e6) / 1e6 };
  await persist(project, session, s);
  return s;
}

/** True (+reason) if `estimateUsd` would push spend over the cap. */
export async function wouldExceedBudget(project: string, session: string, estimateUsd: number): Promise<{ blocked: boolean; reason?: string; spend: AssetSpend }> {
  const spend = await loadSpend(project, session);
  if (spend.budgetUsd != null && spend.totalUsd + estimateUsd > spend.budgetUsd) {
    return { blocked: true, reason: `budget cap $${spend.budgetUsd.toFixed(2)} would be exceeded ($${spend.totalUsd.toFixed(2)} spent + $${estimateUsd.toFixed(2)} est)`, spend };
  }
  return { blocked: false, spend };
}

async function persist(project: string, session: string, s: AssetSpend): Promise<void> {
  await mkdir(join(project, '.collab', 'sessions', session), { recursive: true });
  await writeFile(spendPath(project, session), JSON.stringify(s, null, 2), 'utf-8');
}

/** Estimate USD for an operation before running it. */
export function estimateCost(op: string, p: Record<string, any> = {}): { usd: number; breakdown: string } {
  const n = (v: any, d: number) => (typeof v === 'number' && v > 0 ? v : d);
  switch (op) {
    case 'image': case 'prop': return { usd: COST.image, breakdown: '1 image' };
    case 'sprite_animation': case 'sprite_rotation': case 'vfx': return { usd: COST.video, breakdown: '1 video' };
    case 'sprite_sheet': return { usd: COST.image + COST.video, breakdown: '1 image + 1 video' };
    case 'character_animations': {
      const a = n(p.actions, 1); return { usd: a * (COST.image + COST.video), breakdown: `${a} actions × (1 image + 1 video)` };
    }
    case 'tileset': { const t = n(p.tiles, 1); return { usd: t * COST.image, breakdown: `${t} tiles × 1 image` }; }
    case 'background': { const l = 1 + n(p.layers, 0); return { usd: l * COST.image, breakdown: `${l} layer(s) × 1 image` }; }
    case 'voiceover': case 'tts': { const c = n(p.chars, 50); return { usd: c * COST.tts_per_char, breakdown: `${c} chars × $4.20/1M` }; }
    default: return { usd: 0, breakdown: 'unknown op' };
  }
}
