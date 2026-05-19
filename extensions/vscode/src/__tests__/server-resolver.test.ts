import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';

// --- Mocks for node builtins the module imports ---
const { mockReadFile, mockReaddir, mockExistsSync, mockHomedir, mockExecAsync } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockReaddir: vi.fn(),
    mockExistsSync: vi.fn(),
    mockHomedir: vi.fn(),
    mockExecAsync: vi.fn(),
  }));

vi.mock('fs/promises', () => ({
  readFile: (...a: unknown[]) => mockReadFile(...a),
  readdir: (...a: unknown[]) => mockReaddir(...a),
}));
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
}));
vi.mock('os', () => ({
  homedir: () => mockHomedir(),
}));
vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('util', () => ({
  promisify: () => (...a: unknown[]) => mockExecAsync(...a),
}));

import { resolveServerSource } from '../server-resolver';

const HOME = '/home/test';
const CACHE_PARENT = path.join(
  HOME, '.claude', 'plugins', 'cache', 'mermaid-collab-dev', 'mermaid-collab'
);

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockHomedir.mockReturnValue(HOME);
  // default: bun resolves via `which bun` and validates fine
  mockExecAsync.mockResolvedValue({ stdout: '1.1.0\n' });
  for (const k of ['MERMAID_COLLAB_ROOT', 'CLAUDE_PLUGIN_ROOT', 'BUN_PATH']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ['MERMAID_COLLAB_ROOT', 'CLAUDE_PLUGIN_ROOT', 'BUN_PATH']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Make existsSync true for the standard files under a valid root dir. */
function validRoot(root: string) {
  mockExistsSync.mockImplementation((p: string) =>
    p === path.join(root, 'src', 'server.ts') ||
    p === path.join(root, 'package.json')
  );
}

describe('resolveServerSource — rootDir resolution', () => {
  it('uses MERMAID_COLLAB_ROOT env when valid', async () => {
    process.env.MERMAID_COLLAB_ROOT = '/opt/mc';
    validRoot('/opt/mc');
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '9.9.9' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe('/opt/mc');
    expect(res.version).toBe('9.9.9');
  });

  it('falls back to CLAUDE_PLUGIN_ROOT when MERMAID_COLLAB_ROOT unset', async () => {
    process.env.CLAUDE_PLUGIN_ROOT = '/opt/plugin';
    validRoot('/opt/plugin');
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe('/opt/plugin');
  });

  it('falls back to highest-semver dir in the plugin cache glob', async () => {
    const chosen = path.join(CACHE_PARENT, '1.2.0');
    mockReaddir.mockResolvedValue(['1.0.9', '1.0.10', '1.2.0']);
    validRoot(chosen);
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.2.0' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe(chosen);
  });

  it('throws when nothing can be located', async () => {
    mockReaddir.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(false);

    await expect(resolveServerSource()).rejects.toThrow(
      'Could not locate mermaid-collab source dir'
    );
  });
});

describe('findHighestSemverDir (via glob fallback)', () => {
  it('orders numerically, not lexically (1.0.10 > 1.0.9)', async () => {
    const chosen = path.join(CACHE_PARENT, '1.0.10');
    mockReaddir.mockResolvedValue(['1.0.9', '1.0.10']);
    validRoot(chosen);
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.10' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe(chosen);
  });

  it('prefers a plain release over an equal pre-release', async () => {
    const chosen = path.join(CACHE_PARENT, '1.0.17');
    mockReaddir.mockResolvedValue(['1.0.17', '1.0.17-rc1']);
    validRoot(chosen);
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.17' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe(chosen);
  });

  it('still picks a pre-release over an older stable', async () => {
    const chosen = path.join(CACHE_PARENT, '1.0.17-rc1');
    mockReaddir.mockResolvedValue(['1.0.17-rc1', '1.0.16']);
    validRoot(chosen);
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.17-rc1' }));

    const res = await resolveServerSource();
    expect(res.rootDir).toBe(chosen);
  });
});

describe('bun resolution', () => {
  beforeEach(() => {
    process.env.MERMAID_COLLAB_ROOT = '/opt/mc';
    validRoot('/opt/mc');
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
  });

  it('uses BUN_PATH env when validateBun passes', async () => {
    process.env.BUN_PATH = '/custom/bun';
    mockExecAsync.mockResolvedValue({ stdout: '1.1.0\n' });

    const res = await resolveServerSource();
    expect(res.bunPath).toBe('/custom/bun');
    expect(mockExecAsync).toHaveBeenCalledWith('"/custom/bun" --version');
  });

  it('uses `which bun` path when BUN_PATH unset', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which bun') return { stdout: '/usr/local/bin/bun\n' };
      return { stdout: '1.1.0\n' };
    });

    const res = await resolveServerSource();
    expect(res.bunPath).toBe('/usr/local/bin/bun');
  });

  it('falls back to ~/.bun when which fails', async () => {
    const fallback = path.join(HOME, '.bun', 'bin', 'bun');
    mockExistsSync.mockImplementation((p: string) =>
      p === path.join('/opt/mc', 'src', 'server.ts') ||
      p === path.join('/opt/mc', 'package.json') ||
      p === fallback
    );
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which bun') throw new Error('not found');
      return { stdout: '1.1.0\n' };
    });

    const res = await resolveServerSource();
    expect(res.bunPath).toBe(fallback);
  });

  it('throws when all bun lookups fail', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd === 'which bun') throw new Error('not found');
      throw new Error('invalid');
    });

    await expect(resolveServerSource()).rejects.toThrow(
      'Could not locate bun binary'
    );
  });
});

describe('version read', () => {
  beforeEach(() => {
    process.env.MERMAID_COLLAB_ROOT = '/opt/mc';
    validRoot('/opt/mc');
  });

  it('reads version from <rootDir>/package.json', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '5.0.1' }));
    const res = await resolveServerSource();
    expect(res.version).toBe('5.0.1');
  });

  it('returns "unknown" when package.json is missing/invalid', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const res = await resolveServerSource();
    expect(res.version).toBe('unknown');
  });

  it('returns "unknown" when version field absent', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'x' }));
    const res = await resolveServerSource();
    expect(res.version).toBe('unknown');
  });
});
