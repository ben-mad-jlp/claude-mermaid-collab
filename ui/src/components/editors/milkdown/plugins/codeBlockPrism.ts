import type { MilkdownPlugin } from '@milkdown/ctx';
import { prism } from '@milkdown/plugin-prism';

// Side-effect: load Prism themes so highlighted tokens get styled.
import 'prismjs/themes/prism.css';
import 'prismjs/themes/prism-tomorrow.css';

// Suppress the "Unsupported language detected" warning that fires on every
// keystroke when a code fence has no language specified — cosmetic noise only.
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Unsupported language detected')) return;
  _warn(...args);
};

/**
 * Milkdown Prism plugin wrapper. Uses @milkdown/plugin-prism + the bundled
 * refractor common languages (via the plugin's default ctx). Per guiding
 * principle — built-in Milkdown plugin, not a custom NodeView integration.
 */
export const codeBlockPrismPlugin: MilkdownPlugin[] = prism;
