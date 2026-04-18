import type { MilkdownPlugin } from '@milkdown/ctx';
import { prism } from '@milkdown/plugin-prism';

// Side-effect: load Prism themes so highlighted tokens get styled.
import 'prismjs/themes/prism.css';
import 'prismjs/themes/prism-tomorrow.css';

/**
 * Milkdown Prism plugin wrapper. Uses @milkdown/plugin-prism + the bundled
 * refractor common languages (via the plugin's default ctx). Per guiding
 * principle — built-in Milkdown plugin, not a custom NodeView integration.
 */
export const codeBlockPrismPlugin: MilkdownPlugin[] = prism;
