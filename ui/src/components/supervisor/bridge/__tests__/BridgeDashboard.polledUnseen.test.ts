import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'BridgeDashboard.tsx'),
  'utf-8',
);

/** Isolate a `const name = useCallback(() => { ... }, [...])` body (brace-matched). */
function extractUseCallbackBody(src: string, name: string): string {
  const marker = `const ${name} = useCallback(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`useCallback ${name} not found`);
  const after = src.slice(start + marker.length);
  const arrow = after.search(/=>\s*\{/);
  if (arrow < 0) throw new Error(`useCallback ${name}: no arrow body`);
  const bodyOpen = after.indexOf('{', arrow);
  let depth = 0;
  for (let i = bodyOpen; i < after.length; i++) {
    const ch = after[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return after.slice(bodyOpen + 1, i);
    }
  }
  throw new Error(`useCallback ${name}: unmatched braces`);
}

describe('BridgeDashboard polled unseen wiring', () => {
  it('BridgeDashboard imports and calls usePolledResource', () => {
    // Tolerates sibling named imports from the same module (e.g. POLL_INTERVAL_MS);
    // the assertion is that BridgeDashboard imports usePolledResource, not that it is
    // the only name imported.
    expect(SRC).toMatch(
      /import\s*\{[^}]*\busePolledResource\b[^}]*\}\s*from\s*['"]@\/hooks\/usePolledResource['"]/,
    );
    expect(SRC).toMatch(/usePolledResource[\s\S]*?['"]bridge-unseen['"]/);
    expect(SRC).toMatch(/project\s*\|\|\s*undefined/);
    expect(SRC).toContain('/api/subscriptions?project=');
  });

  it('onManualRefresh calls refreshNow', () => {
    const body = extractUseCallbackBody(SRC, 'onManualRefresh');
    expect(body).toMatch(/refreshNow\s*\(/);
  });

  it('resyncBridge has a single owner for the subscriptions read', () => {
    const body = extractUseCallbackBody(SRC, 'resyncBridge');
    expect(body).not.toContain('/api/subscriptions');
  });
});
