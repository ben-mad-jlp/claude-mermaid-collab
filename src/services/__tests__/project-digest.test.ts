import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DIGEST_HEADER,
  estimateTokens,
  assembleDigest,
  writeProjectDigest,
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
});
