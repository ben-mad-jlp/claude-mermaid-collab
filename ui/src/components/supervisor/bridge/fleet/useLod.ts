/**
 * useLod — semantic-zoom level of detail for FleetGraph nodes (BR-3, design §3).
 *
 * L0 (far): epic-summary dots. L1 (mid): status pills. L2 (near): full cards.
 * Derived live from the React Flow zoom, overridable by the HUD via
 * deckStore.forcedLod. Reading zoom through `useStore` keeps node geometry
 * stable — only the rendered detail changes, never positions.
 */

import { useStore } from '@xyflow/react';
import { useDeckStore, type Lod } from '@/stores/deckStore';

export function lodForZoom(zoom: number): Lod {
  if (zoom < 0.5) return 0;
  if (zoom < 0.9) return 1;
  return 2;
}

export function useLod(): Lod {
  const zoom = useStore((s) => s.transform[2]);
  const forced = useDeckStore((s) => s.forcedLod);
  return forced ?? lodForZoom(zoom);
}
