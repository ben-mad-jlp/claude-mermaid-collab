import { describe, it, expect, vi } from 'vitest';
import {
  autostartDir,
  autostartFilePath,
  desktopEntryContent,
  installLinuxAutostart,
} from '../linux-autostart';

const HOME = '/home/tester';

describe('autostart paths', () => {
  it('defaults to ~/.config/autostart', () => {
    expect(autostartDir({ home: HOME, env: {} })).toBe('/home/tester/.config/autostart');
    expect(autostartFilePath({ home: HOME, env: {} })).toBe(
      '/home/tester/.config/autostart/mermaid-collab.desktop',
    );
  });

  it('honors XDG_CONFIG_HOME', () => {
    expect(autostartDir({ home: HOME, env: { XDG_CONFIG_HOME: '/cfg' } })).toBe('/cfg/autostart');
  });
});

describe('desktopEntryContent', () => {
  it('renders a valid freedesktop entry with the given Exec', () => {
    const c = desktopEntryContent({ exec: '/opt/mermaid-collab/mermaid-collab' });
    expect(c).toContain('[Desktop Entry]');
    expect(c).toContain('Type=Application');
    expect(c).toContain('Exec=/opt/mermaid-collab/mermaid-collab');
    expect(c).toContain('Icon=mermaid-collab');
    expect(c).toContain('X-GNOME-Autostart-enabled=true');
    expect(c.endsWith('\n')).toBe(true);
  });
});

function mockFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string) => files.get(p) ?? '',
    writeFileSync: (p: string, data: string) => { files.set(p, data); },
    mkdirSync: vi.fn(),
  };
}

describe('installLinuxAutostart', () => {
  const base = { home: HOME, env: {}, exec: '/usr/bin/mermaid-collab', platform: 'linux' as const };

  it('no-ops on non-linux platforms (macOS unaffected)', () => {
    const fsImpl = mockFs();
    expect(installLinuxAutostart({ ...base, platform: 'darwin', fsImpl })).toBe('skipped-not-linux');
    expect(fsImpl.files.size).toBe(0);
  });

  it('installs a fresh entry', () => {
    const fsImpl = mockFs();
    expect(installLinuxAutostart({ ...base, fsImpl })).toBe('installed');
    const written = fsImpl.files.get('/home/tester/.config/autostart/mermaid-collab.desktop');
    expect(written).toContain('Exec=/usr/bin/mermaid-collab');
  });

  it('is idempotent — unchanged content is not rewritten', () => {
    const fsImpl = mockFs();
    installLinuxAutostart({ ...base, fsImpl });
    expect(installLinuxAutostart({ ...base, fsImpl })).toBe('unchanged');
  });

  it('updates when the Exec path changes', () => {
    const fsImpl = mockFs();
    installLinuxAutostart({ ...base, fsImpl });
    expect(installLinuxAutostart({ ...base, exec: '/new/path', fsImpl })).toBe('updated');
    expect(fsImpl.files.get('/home/tester/.config/autostart/mermaid-collab.desktop')).toContain('Exec=/new/path');
  });

  it('respects a user-disabled entry and does not re-enable it', () => {
    const filePath = '/home/tester/.config/autostart/mermaid-collab.desktop';
    const fsImpl = mockFs({
      [filePath]: '[Desktop Entry]\nExec=/usr/bin/mermaid-collab\nX-GNOME-Autostart-enabled=false\n',
    });
    expect(installLinuxAutostart({ ...base, fsImpl })).toBe('skipped-disabled');
    expect(fsImpl.files.get(filePath)).toContain('enabled=false');
  });
});
