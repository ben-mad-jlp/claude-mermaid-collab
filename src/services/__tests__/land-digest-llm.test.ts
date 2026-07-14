import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { refreshProjectDigestOnLand } from '../coordinator-live.ts';
import type { DigestSynthesis } from '../project-digest.ts';

function makeGitProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'digest-llm-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'config', 'user.email', 't@t'], { cwd: dir });
  Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Conventions\nUse npm version for bumps.\n');
  Bun.spawnSync(['git', 'add', '-A'], { cwd: dir });
  Bun.spawnSync(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

describe('refreshProjectDigestOnLand — production DigestLlm wiring', () => {
  test('changed skeleton → default path invokes the injected llm and fills dir purposes', async () => {
    const project = makeGitProject();
    try {
      const digestLlm = mock(async (): Promise<DigestSynthesis> => ({
        dirPurposes: { src: 'backend + MCP source' },
        seams: ['use npm version for bumps'],
      }));
      await refreshProjectDigestOnLand(project, { digestEnabled: () => true, digestLlm });
      expect(digestLlm).toHaveBeenCalledTimes(1);
      const md = readFileSync(join(project, '.collab', 'project-digest.md'), 'utf-8');
      expect(md).toContain('`src/` — backend + MCP source');
      expect(md).toContain('use npm version for bumps');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('flag OFF → llm is never called', async () => {
    const project = makeGitProject();
    try {
      const digestLlm = mock(async () => ({ dirPurposes: {}, seams: [] }));
      await refreshProjectDigestOnLand(project, { digestEnabled: () => false, digestLlm });
      expect(digestLlm).toHaveBeenCalledTimes(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('a throwing llm does not propagate (land unaffected)', async () => {
    const project = makeGitProject();
    try {
      const digestLlm = mock(async () => {
        throw new Error('boom');
      });
      await expect(
        refreshProjectDigestOnLand(project, { digestEnabled: () => true, digestLlm }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
