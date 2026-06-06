// Tech-pack writable store (Profile L4b, fd052733): registerPack persists an
// approved pack into a cross-project JSON store; listPacks + resolveTechPacks read
// the merged seed + stored set. Uses real fs (tmp store via MERMAID_TECH_PACKS_PATH),
// so runs under bun test.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPack, listPacks, resolveTechPacks, TECH_PACKS, type TechPack } from '../tech-packs';

let dir: string;
const prevEnv = process.env.MERMAID_TECH_PACKS_PATH;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'techpacks-'));
  process.env.MERMAID_TECH_PACKS_PATH = join(dir, 'tech-packs.json');
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  if (prevEnv === undefined) delete process.env.MERMAID_TECH_PACKS_PATH;
  else process.env.MERMAID_TECH_PACKS_PATH = prevEnv;
});

const pack = (over: Partial<TechPack> = {}): TechPack => ({
  id: 'ros2',
  description: 'ROS2 robotics middleware',
  contextPrompt: 'You are working in a ROS2 workspace.',
  allowedTools: 'mcp__ros2',
  ...over,
});

describe('registerPack + listPacks', () => {
  test('with no store, listPacks returns exactly the seed', () => {
    const ids = listPacks().map((p) => p.id).sort();
    expect(ids).toEqual(Object.keys(TECH_PACKS).sort());
  });

  test('registerPack persists a new pack that listPacks then sees', () => {
    expect(listPacks().some((p) => p.id === 'ros2')).toBe(false);
    registerPack(pack());
    expect(existsSync(process.env.MERMAID_TECH_PACKS_PATH!)).toBe(true);
    const found = listPacks().find((p) => p.id === 'ros2');
    expect(found?.description).toBe('ROS2 robotics middleware');
    // seed packs are still present alongside the stored one
    expect(listPacks().some((p) => p.id === 'cad')).toBe(true);
  });

  test('a stored pack with a seed id OVERRIDES the seed', () => {
    registerPack(pack({ id: 'cad', description: 'overridden cad', contextPrompt: 'x', allowedTools: '' }));
    const cad = listPacks().filter((p) => p.id === 'cad');
    expect(cad).toHaveLength(1); // not duplicated
    expect(cad[0].description).toBe('overridden cad');
  });

  test('persistence survives across calls (cross-process: re-reads the file)', () => {
    registerPack(pack({ id: 'web-vue', description: 'Vue frontend', contextPrompt: 'v', allowedTools: '' }));
    // a second register (separate read/modify/write) keeps the first
    registerPack(pack({ id: 'embedded', description: 'Embedded C', contextPrompt: 'e', allowedTools: '' }));
    const onDisk = JSON.parse(readFileSync(process.env.MERMAID_TECH_PACKS_PATH!, 'utf8'));
    expect(Object.keys(onDisk).sort()).toEqual(['embedded', 'web-vue']);
  });
});

describe('registerPack validation (fail loud)', () => {
  test('rejects a non-kebab id', () => {
    expect(() => registerPack(pack({ id: 'ROS Two' }))).toThrow(/kebab/);
  });
  test('rejects a missing description', () => {
    expect(() => registerPack(pack({ description: '  ' }))).toThrow(/description/);
  });
  test('rejects a non-string allowedTools', () => {
    expect(() => registerPack(pack({ allowedTools: 42 as unknown as string }))).toThrow(/allowedTools/);
  });
});

describe('resolveTechPacks reads the merged library', () => {
  test('resolves a stored pack id (not just seed ids)', () => {
    registerPack(pack());
    const resolved = resolveTechPacks(['ros2', 'cad', 'nope']);
    expect(resolved.map((p) => p.id)).toEqual(['ros2', 'cad']);
  });
  test('still drops unknown + duplicate ids', () => {
    expect(resolveTechPacks(['cad', 'nope', 'cad']).map((p) => p.id)).toEqual(['cad']);
  });
});
