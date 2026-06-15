/**
 * WSL state detection + onboarding guidance (Windows port, P5 / 619f6c35).
 *
 * Pure parsers for `wsl.exe` output + a `detectWslState` orchestrator (injectable
 * exec) so onboarding can answer "is this machine ready to run the sidecar in
 * WSL, and if not, what's the next step?" without a live WSL on the dev box. The
 * parsers are the testable core (sampled from a real Windows 11 ARM VM, 2026-06-15
 * — see doc winport-wsl-validation-2026-06-15).
 *
 * IMPORTANT: `wsl.exe` writes UTF-16LE. Callers MUST decode to a JS string before
 * handing output to these parsers (the parsers also strip stray NULs defensively).
 */

export interface WslDistro {
  name: string;
  state: string; // Running | Stopped | Installing | …
  version: number; // 1 or 2
  default: boolean; // the `*`-marked default distro
}

export interface WslState {
  /** `wsl.exe` is present AND reports a version (engine installed). */
  installed: boolean;
  /** The WSL engine version (e.g. "2.6.1.0"), or null. */
  wslVersion: string | null;
  /** The Linux kernel version the engine ships, or null. */
  kernelVersion: string | null;
  distros: WslDistro[];
  /** True if at least one distro is registered as WSL **2** — the product path. */
  hasV2Distro: boolean;
  /** First actionable onboarding step, or null when ready (a v2 distro exists). */
  nextStep:
    | null
    | 'install-wsl' // engine missing
    | 'install-distro' // engine present, no distro
    | 'convert-distro-v2'; // distro(s) exist but none on v2
}

const strip = (s: string): string => s.replace(/\0/g, '');

/** Parse `wsl.exe --version` → { wslVersion, kernelVersion }. */
export function parseWslVersion(out: string): { wslVersion: string | null; kernelVersion: string | null } {
  const s = strip(out);
  const wsl = s.match(/WSL version:\s*([\d.]+)/i);
  const kern = s.match(/Kernel version:\s*([\d.\-]+)/i);
  return { wslVersion: wsl?.[1] ?? null, kernelVersion: kern?.[1] ?? null };
}

/** Parse `wsl.exe -l -v` → distro rows. Tolerates the leading `*` default marker,
 *  variable whitespace, and the header row. */
export function parseDistros(out: string): WslDistro[] {
  const rows: WslDistro[] = [];
  for (const raw of strip(out).split('\n')) {
    const line = raw.replace(/\r/g, '').trimEnd();
    if (!line.trim()) continue;
    // "* Ubuntu-24.04    Stopped         1"  /  "  Debian   Running   2"
    const m = line.match(/^(\*?)\s*(\S+)\s+(\S+)\s+(\d+)\s*$/);
    if (!m) continue; // header ("NAME STATE VERSION") + noise
    const version = Number(m[4]);
    if (version !== 1 && version !== 2) continue; // header's "VERSION" already filtered by \d+, belt-and-suspenders
    rows.push({ default: m[1] === '*', name: m[2], state: m[3], version });
  }
  return rows;
}

/** Injectable exec: run `wsl.exe <args>` and return decoded stdout (+ exit code). */
export type WslExec = (args: string[]) => Promise<{ code: number; out: string }>;

/**
 * Detect the machine's WSL readiness for running the sidecar in WSL. Best-effort:
 * any exec failure degrades to "not installed". Returns the parsed state plus the
 * single next onboarding step.
 */
export async function detectWslState(exec: WslExec): Promise<WslState> {
  let version = { wslVersion: null as string | null, kernelVersion: null as string | null };
  let installed = false;
  try {
    const v = await exec(['--version']);
    version = parseWslVersion(v.out);
    installed = v.code === 0 && version.wslVersion != null;
  } catch {
    installed = false;
  }

  let distros: WslDistro[] = [];
  if (installed) {
    try {
      const d = await exec(['-l', '-v']);
      distros = parseDistros(d.out);
    } catch {
      distros = [];
    }
  }

  const hasV2Distro = distros.some((d) => d.version === 2);
  const nextStep: WslState['nextStep'] = !installed
    ? 'install-wsl'
    : distros.length === 0
      ? 'install-distro'
      : !hasV2Distro
        ? 'convert-distro-v2'
        : null;

  return { installed, ...version, distros, hasV2Distro, nextStep };
}
