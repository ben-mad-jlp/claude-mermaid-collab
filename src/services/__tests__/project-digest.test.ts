import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_HEADER,
  estimateTokens,
  assembleDigest,
  writeProjectDigest,
  computeSkeletonHash,
  regenerateProjectDigest,
  boundSynthesis,
  DigestSynthesis,
} from '../project-digest';

describe('project-digest generator', () => {
  describe('assembleDigest', () => {
    test('truncates over-budget content and preserves header', () => {
      // Force an oversized body that will exceed the 5000-token budget.
      const largebody = 'x'.repeat(50_000);
      const result = assembleDigest(largebody);

      // Assert budget is respected.
      expect(result.tokens).toBeLessThanOrEqual(5000);

      // Assert truncation marker is present.
      expect(result.markdown).toContain('[digest truncated]');

      // Assert header is still at the start.
      expect(result.markdown).toStartWith(DIGEST_HEADER);
    });

    test('estimateTokens returns ceil(length/4)', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
      expect(estimateTokens('x'.repeat(100))).toBe(25);
    });
  });

  describe('writeProjectDigest', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'project-digest-'));
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test('writes .collab/project-digest.md and .meta.json with correct sections', () => {
      const digest = writeProjectDigest(tmpDir);

      // Read the written markdown file.
      const mdPath = join(tmpDir, '.collab', 'project-digest.md');
      const mdContent = readFileSync(mdPath, 'utf-8');

      // Assert header is present.
      expect(mdContent).toStartWith(DIGEST_HEADER);

      // Assert all four section headers are present.
      expect(mdContent).toContain('## Where things live');
      expect(mdContent).toContain('## Key seams & conventions');
      expect(mdContent).toContain('## Artifacts');
      expect(mdContent).toContain('## Deeper docs');

      // Read and parse the sidecar metadata.
      const metaPath = join(tmpDir, '.collab', 'project-digest.meta.json');
      const metaContent = readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);

      // Assert required metadata fields.
      expect(meta).toHaveProperty('tokens');
      expect(meta).toHaveProperty('generatedAt');
      expect(meta).toHaveProperty('generatedAtSha');
      expect(meta).toHaveProperty('skeletonHash');

      // Assert tokens are within budget.
      expect(meta.tokens).toBeLessThanOrEqual(5000);

      // Assert returned digest matches the written file.
      expect(digest.markdown).toBe(mdContent);
    });
  });

  describe('regenerateProjectDigest — skeleton hash + LLM skip', () => {
    function initRepo(dir: string, claudeMd: string) {
      const git = (args: string[]) =>
        Bun.spawnSync(['git', ...args], {
          cwd: dir,
          stdout: 'ignore',
          stderr: 'ignore',
        });
      git(['init']);
      git(['config', 'user.email', 't@t']);
      git(['config', 'user.name', 't']);
      writeFileSync(join(dir, 'CLAUDE.md'), claudeMd);
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;');
      git(['add', '-A']);
      git(['commit', '-m', 'init']);
    }

    test('changed hash → exactly one LLM call', async () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), 'digest-regen-'));
      try {
        initRepo(tmpDir, '# CLAUDE.md\nversion 1');
        const llm = mock(() => ({
          dirPurposes: { src: 'services' },
          seams: ['x'],
        }));

        await regenerateProjectDigest(tmpDir, { llm });

        expect(llm).toHaveBeenCalledTimes(1);

        const metaPath = join(tmpDir, '.collab', 'project-digest.meta.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        expect(meta.tokens).toBeLessThanOrEqual(5000);
        expect(meta.synthesis).toBeDefined();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('unchanged hash → zero LLM calls', async () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), 'digest-regen-'));
      try {
        initRepo(tmpDir, '# CLAUDE.md\nversion 1');
        const llm = mock(() => ({
          dirPurposes: { src: 'services' },
          seams: ['x'],
        }));

        // First call
        await regenerateProjectDigest(tmpDir, { llm });
        expect(llm).toHaveBeenCalledTimes(1);

        // Second call with unchanged hash should not call llm
        const llm2 = mock(() => ({
          dirPurposes: { src: 'services' },
          seams: ['y'],
        }));
        await regenerateProjectDigest(tmpDir, { llm: llm2 });

        expect(llm2).toHaveBeenCalledTimes(0);

        // Verify the reused synthesis is from the first call
        const mdPath = join(tmpDir, '.collab', 'project-digest.md');
        const mdContent = readFileSync(mdPath, 'utf-8');
        expect(mdContent).toContain('services'); // from first llm call
        expect(mdContent).not.toContain('seam y'); // from second llm call
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('hash changes when a path is added', () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), 'digest-hash-'));
      try {
        initRepo(tmpDir, '# CLAUDE.md');
        const h1 = computeSkeletonHash(tmpDir);

        // Add a new dir
        mkdirSync(join(tmpDir, 'newmod'), { recursive: true });
        writeFileSync(join(tmpDir, 'newmod', 'x.ts'), 'export const x = 1;');
        const git = (args: string[]) =>
          Bun.spawnSync(['git', ...args], {
            cwd: tmpDir,
            stdout: 'ignore',
            stderr: 'ignore',
          });
        git(['add', '-A']);

        const h2 = computeSkeletonHash(tmpDir);
        expect(h1).not.toBe(h2);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('hash changes when CLAUDE.md changes', () => {
      const tmpDir = mkdtempSync(join(os.tmpdir(), 'digest-hash-'));
      try {
        initRepo(tmpDir, '# CLAUDE.md\noriginal');
        const h1 = computeSkeletonHash(tmpDir);

        writeFileSync(join(tmpDir, 'CLAUDE.md'), '# CLAUDE.md\nmodified');

        const h2 = computeSkeletonHash(tmpDir);
        expect(h1).not.toBe(h2);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('boundSynthesis clamps', () => {
      const longPurpose = 'a'.repeat(200);
      const tooManySeams = Array.from({ length: 15 }, (_, i) => `seam${i}`);
      const tooLongSeam = 'x'.repeat(500);

      const input: DigestSynthesis = {
        dirPurposes: { dir1: longPurpose },
        seams: [...tooManySeams, tooLongSeam],
      };

      const bounded = boundSynthesis(input);

      expect(bounded.dirPurposes.dir1.length).toBeLessThanOrEqual(100);
      expect(bounded.seams.length).toBeLessThanOrEqual(8);
      for (const seam of bounded.seams) {
        expect(seam.length).toBeLessThanOrEqual(160);
      }
    });
  });
});
