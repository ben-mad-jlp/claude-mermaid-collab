import { describe, it, expect } from 'vitest';
import {
  xdgConfigHome,
  xdgDataHome,
  xdgCacheHome,
  mcConfigDir,
  mcDataDir,
  mcCacheDir,
  mcLegacyHome,
} from '../xdg-paths';

const HOME = '/home/tester';

describe('xdg-paths (Linux)', () => {
  const base = { home: HOME, platform: 'linux' as const };

  it('falls back to ~/.config / ~/.local/share / ~/.cache when XDG vars are unset', () => {
    const env = {};
    expect(xdgConfigHome({ ...base, env })).toBe('/home/tester/.config');
    expect(xdgDataHome({ ...base, env })).toBe('/home/tester/.local/share');
    expect(xdgCacheHome({ ...base, env })).toBe('/home/tester/.cache');
  });

  it('honors explicitly-set absolute XDG vars', () => {
    const env = {
      XDG_CONFIG_HOME: '/custom/cfg',
      XDG_DATA_HOME: '/custom/data',
      XDG_CACHE_HOME: '/custom/cache',
    };
    expect(xdgConfigHome({ ...base, env })).toBe('/custom/cfg');
    expect(xdgDataHome({ ...base, env })).toBe('/custom/data');
    expect(xdgCacheHome({ ...base, env })).toBe('/custom/cache');
  });

  it('ignores a relative (non-absolute) XDG var and uses the fallback', () => {
    const env = { XDG_CONFIG_HOME: 'relative/cfg' };
    expect(xdgConfigHome({ ...base, env })).toBe('/home/tester/.config');
  });

  it('namespaces per-app dirs under mermaid-collab', () => {
    const env = {};
    expect(mcConfigDir({ ...base, env })).toBe('/home/tester/.config/mermaid-collab');
    expect(mcDataDir({ ...base, env })).toBe('/home/tester/.local/share/mermaid-collab');
    expect(mcCacheDir({ ...base, env })).toBe('/home/tester/.cache/mermaid-collab');
  });
});

describe('xdg-paths (macOS unaffected)', () => {
  const base = { home: HOME, platform: 'darwin' as const, env: {} };

  it('uses ~/Library defaults on darwin when no XDG var is set', () => {
    expect(xdgConfigHome(base)).toBe('/home/tester/Library/Application Support');
    expect(xdgCacheHome(base)).toBe('/home/tester/Library/Caches');
  });

  it('still honors an explicit XDG var on darwin (opt-in)', () => {
    expect(xdgConfigHome({ ...base, env: { XDG_CONFIG_HOME: '/opt/cfg' } })).toBe('/opt/cfg');
  });
});

describe('legacy home stays at ~/.mermaid-collab (no migration)', () => {
  it('resolves the dotdir regardless of platform/XDG', () => {
    expect(mcLegacyHome({ home: HOME, platform: 'linux', env: { XDG_DATA_HOME: '/custom' } }))
      .toBe('/home/tester/.mermaid-collab');
    expect(mcLegacyHome({ home: HOME, platform: 'darwin' })).toBe('/home/tester/.mermaid-collab');
  });
});
