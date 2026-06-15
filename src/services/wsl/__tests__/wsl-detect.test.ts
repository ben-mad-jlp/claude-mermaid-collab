/**
 * P5: WSL detection parsers + detectWslState onboarding logic. Fixtures are the
 * real `wsl.exe` output captured from a Windows 11 ARM VM (2026-06-15).
 */
import { describe, it, expect } from 'bun:test';
import { parseWslVersion, parseDistros, detectWslState, type WslExec } from '../wsl-detect.ts';

const VERSION_OUT = `WSL version: 2.6.1.0
Kernel version: 6.6.87.2-1
WSLg version: 1.0.66
MSRDC version: 1.2.6353
Direct3D version: 1.611.1-81528511
Windows version: 10.0.26200.8328`;

const DISTROS_OUT = `  NAME            STATE           VERSION
* Ubuntu-24.04    Stopped         1`;

const DISTROS_MIXED = `  NAME            STATE           VERSION
* Ubuntu-24.04    Running         2
  Debian          Stopped         1`;

describe('parseWslVersion', () => {
  it('extracts WSL + kernel versions', () => {
    expect(parseWslVersion(VERSION_OUT)).toEqual({ wslVersion: '2.6.1.0', kernelVersion: '6.6.87.2-1' });
  });
  it('tolerates UTF-16 NULs and missing fields', () => {
    expect(parseWslVersion('W\0S\0L\0 \0version: 2.7.8.0')).toEqual({ wslVersion: '2.7.8.0', kernelVersion: null });
    expect(parseWslVersion('garbage')).toEqual({ wslVersion: null, kernelVersion: null });
  });
});

describe('parseDistros', () => {
  it('parses the default-marked single distro (skips header)', () => {
    expect(parseDistros(DISTROS_OUT)).toEqual([
      { name: 'Ubuntu-24.04', state: 'Stopped', version: 1, default: true },
    ]);
  });
  it('parses multiple distros + default marker + versions', () => {
    expect(parseDistros(DISTROS_MIXED)).toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', version: 2, default: true },
      { name: 'Debian', state: 'Stopped', version: 1, default: false },
    ]);
  });
  it('returns [] for no-distro output', () => {
    expect(parseDistros('Windows Subsystem for Linux has no installed distributions.')).toEqual([]);
  });
});

describe('detectWslState (onboarding next-step)', () => {
  const exec = (map: Record<string, { code: number; out: string }>): WslExec =>
    async (args) => map[args.join(' ')] ?? { code: 1, out: '' };

  it('engine missing → install-wsl', async () => {
    const s = await detectWslState(exec({}));
    expect(s.installed).toBe(false);
    expect(s.nextStep).toBe('install-wsl');
  });

  it('engine present, no distro → install-distro', async () => {
    const s = await detectWslState(exec({
      '--version': { code: 0, out: VERSION_OUT },
      '-l -v': { code: 0, out: '  NAME  STATE  VERSION' },
    }));
    expect(s.installed).toBe(true);
    expect(s.wslVersion).toBe('2.6.1.0');
    expect(s.nextStep).toBe('install-distro');
  });

  it('distro on v1 only → convert-distro-v2 (the live VM state)', async () => {
    const s = await detectWslState(exec({
      '--version': { code: 0, out: VERSION_OUT },
      '-l -v': { code: 0, out: DISTROS_OUT },
    }));
    expect(s.hasV2Distro).toBe(false);
    expect(s.nextStep).toBe('convert-distro-v2');
  });

  it('v2 distro present → ready (nextStep null)', async () => {
    const s = await detectWslState(exec({
      '--version': { code: 0, out: VERSION_OUT },
      '-l -v': { code: 0, out: DISTROS_MIXED },
    }));
    expect(s.hasV2Distro).toBe(true);
    expect(s.nextStep).toBeNull();
  });
});
