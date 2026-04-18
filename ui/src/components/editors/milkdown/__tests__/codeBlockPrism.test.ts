import { describe, it, expect, vi } from 'vitest';

vi.mock('prismjs/themes/prism.css', () => ({}));
vi.mock('prismjs/themes/prism-tomorrow.css', () => ({}));

import { codeBlockPrismPlugin } from '../plugins/codeBlockPrism';

describe('codeBlockPrismPlugin', () => {
  it('exports a non-empty array of Milkdown plugins', () => {
    expect(Array.isArray(codeBlockPrismPlugin)).toBe(true);
    expect(codeBlockPrismPlugin.length).toBeGreaterThan(0);
  });

  it('each entry is a function or plugin-shaped object', () => {
    for (const p of codeBlockPrismPlugin) {
      const t = typeof p;
      expect(t === 'function' || t === 'object').toBe(true);
      expect(p).not.toBeNull();
    }
  });
});
