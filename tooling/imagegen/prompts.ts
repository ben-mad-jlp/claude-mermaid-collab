import type { ImageTask } from './providers/types.ts';

/**
 * Task → prompt-preset helpers.
 *
 * 'icon' wraps the subject in a flat-icon style envelope; other tasks pass the
 * prompt through unchanged for now (sprite/concept/prop are reserved for later
 * presets).
 */
export function applyTaskPreset(prompt: string, task?: ImageTask): string {
  switch (task) {
    case 'icon':
      return `simple flat icon, ${prompt}, clean vector-like edges, solid colors, minimal shading, centered, white background, square, app icon style, no text`;
    case 'sprite':
    case 'concept':
    case 'prop':
    default:
      return prompt;
  }
}
