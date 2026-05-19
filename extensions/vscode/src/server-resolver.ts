/**
 * Resolves the mermaid-collab plugin source root and the bun binary on
 * whatever host this extension half is running on (UI host or workspace host).
 */
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ServerSource {
  rootDir: string;   // absolute path to mermaid-collab source dir
  version: string;   // from <rootDir>/package.json
  bunPath: string;   // resolved absolute path to the bun binary
}

/** Returns the highest X.Y.Z child dir of `parent`, or null if none. */
async function findHighestSemverDir(parent: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(parent);
  } catch {
    return null;
  }
  // Accept optional pre-release suffix (e.g. 1.0.17-rc1) so such dirs aren't
  // silently skipped, leaving an older stable as "highest".
  const semver = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;
  const parsed = entries
    .map(e => {
      const m = e.match(semver);
      return m
        ? { name: e, t: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number], pre: m[4] ?? '' }
        : null;
    })
    .filter((x): x is { name: string; t: [number, number, number]; pre: string } => x !== null);
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => {
    const byTuple = b.t[0] - a.t[0] || b.t[1] - a.t[1] || b.t[2] - a.t[2];
    if (byTuple !== 0) return byTuple;
    // Same X.Y.Z: a release (no pre) outranks a pre-release; otherwise compare.
    if (a.pre === b.pre) return 0;
    if (!a.pre) return -1;
    if (!b.pre) return 1;
    return b.pre.localeCompare(a.pre);
  });
  return path.join(parent, parsed[0].name);
}

/** Resolves the source rootDir via env overrides then the plugin cache glob. */
async function resolveRootDir(): Promise<string> {
  const candidates: Array<string | undefined> = [
    process.env.MERMAID_COLLAB_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
  ];
  for (const c of candidates) {
    if (c && existsSync(path.join(c, 'src', 'server.ts')) && existsSync(path.join(c, 'package.json'))) {
      return c;
    }
  }
  const cacheParent = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'mermaid-collab-dev', 'mermaid-collab');
  const latest = await findHighestSemverDir(cacheParent);
  if (latest && existsSync(path.join(latest, 'src', 'server.ts')) && existsSync(path.join(latest, 'package.json'))) {
    return latest;
  }
  throw new Error('Could not locate mermaid-collab source dir — set MERMAID_COLLAB_ROOT');
}

/** Reads the version field from <rootDir>/package.json. */
async function readVersion(rootDir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(rootDir, 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: string }).version;
    return typeof v === 'string' ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Validates a candidate bun path by running `<path> --version`. */
async function validateBun(bunPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`"${bunPath}" --version`);
    return /^\d+\.\d+\.\d+/.test(stdout.trim());
  } catch {
    return false;
  }
}

/** Resolves the bun binary via env, PATH lookup, then the platform default. */
async function resolveBunPath(): Promise<string> {
  const isWin = process.platform === 'win32';

  if (process.env.BUN_PATH && await validateBun(process.env.BUN_PATH)) {
    return process.env.BUN_PATH;
  }

  try {
    const cmd = isWin ? 'where.exe bun' : 'which bun';
    const { stdout } = await execAsync(cmd);
    const first = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && await validateBun(first)) return first;
  } catch {
    /* fall through */
  }

  const fallback = isWin
    ? path.join(os.homedir(), '.bun', 'bin', 'bun.exe')
    : path.join(os.homedir(), '.bun', 'bin', 'bun');
  if (existsSync(fallback) && await validateBun(fallback)) {
    return fallback;
  }

  throw new Error('Could not locate bun binary — install from https://bun.sh or set BUN_PATH');
}

/**
 * Resolves the mermaid-collab source root + version + bun binary for this host.
 * Throws a descriptive Error if either cannot be found.
 */
export async function resolveServerSource(): Promise<ServerSource> {
  const rootDir = await resolveRootDir();
  const version = await readVersion(rootDir);
  const bunPath = await resolveBunPath();
  return { rootDir, version, bunPath };
}
