/**
 * Tests for relative-path prose migration, path normalization, and self-heal.
 *
 * Verifies that absolute paths written by older versions of the tooling are
 * repaired to project-relative POSIX by:
 *   - toRelPosixPath (pure fn)
 *   - readProseFile (opportunistic self-heal when project is passed)
 *   - migrateProseFilesToRelative (on-disk rename + JSON rewrite + _orphan/)
 *   - pseudo_upsert_prose (normalizes absolute input.file before writing)
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { migrateProseFilesToRelative } from '../pseudo-migration.js';
import { toRelPosixPath, escapePath } from '../pseudo-path-escape.js';
import { readProseFile, writeProseFile, type ProseFileV3 } from '../pseudo-prose-file.js';
import { pseudo_upsert_prose } from '../../mcp/tools/pseudo-upsert-prose.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'pseudo-rel-mig-'));
  mkdirSync(join(root, '.collab', 'pseudo', 'prose'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function makeV3(filePath: string): ProseFileV3 {
  return {
    schema_version: 3,
    file: filePath,
    title: 'T',
    purpose: 'P',
    module_context: 'M',
    methods: [
      {
        id: 'abcd1234',
        name: 'fn',
        enclosing_class: null,
        normalized_params: '',
        body_fingerprint: 'h_empty___',
        prose_origin: 'manual',
        steps: [{ order: 0, content: 'step one' }],
        tags: { deprecated: false },
      },
    ],
  };
}

function writeRawJSON(path: string, obj: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// toRelPosixPath
// ---------------------------------------------------------------------------

describe('toRelPosixPath', () => {
  it('returns rel POSIX unchanged (fast path)', () => {
    const project = '/tmp/proj';
    expect(toRelPosixPath(project, 'src/foo.ts')).toBe('src/foo.ts');
  });

  it('converts project-internal absolute to rel POSIX', () => {
    const root = makeProject();
    try {
      const abs = join(root, 'src', 'foo.ts');
      expect(toRelPosixPath(root, abs)).toBe('src/foo.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws on path escaping project root', () => {
    const root = makeProject();
    try {
      expect(() => toRelPosixPath(root, '/Users/someone/unrelated/foo.ts')).toThrow(/outside project root/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes backslashes to forward slashes', () => {
    const root = makeProject();
    try {
      // Input with backslashes triggers the non-fast-path branch; path.resolve
      // on POSIX treats it as a single filename, so it becomes rel-POSIX.
      const result = toRelPosixPath(root, 'src\\foo.ts');
      expect(result).not.toContain('\\');
      expect(result).toContain('/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('handles Windows-absolute input (C:\\...)', () => {
    // Windows-absolute, project is POSIX — this must throw since it's
    // clearly outside the project, and the error message must include the signal.
    expect(() => toRelPosixPath('/tmp/proj', 'C:\\Users\\someone\\foo.ts')).toThrow(/outside project root/);
  });
});

// ---------------------------------------------------------------------------
// readProseFile self-heal
// ---------------------------------------------------------------------------

describe('readProseFile self-heal', () => {
  it('leaves rel path untouched', async () => {
    const root = makeProject();
    try {
      const jsonPath = join(root, '.collab', 'pseudo', 'prose', 'src/foo.ts.json');
      writeRawJSON(jsonPath, makeV3('src/foo.ts'));
      const out = await readProseFile(jsonPath, root);
      expect(out).not.toBeNull();
      expect(out!.file).toBe('src/foo.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('heals absolute in-project path to rel POSIX', async () => {
    const root = makeProject();
    try {
      const abs = join(root, 'src', 'foo.ts');
      const jsonPath = join(root, '.collab', 'pseudo', 'prose', 'whatever.json');
      writeRawJSON(jsonPath, makeV3(abs));
      const out = await readProseFile(jsonPath, root);
      expect(out).not.toBeNull();
      expect(out!.file).toBe('src/foo.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves cross-machine absolute path untouched (migration will handle it)', async () => {
    const root = makeProject();
    try {
      const crossPath = '/Users/someone/unrelated/path/foo.ts';
      const jsonPath = join(root, '.collab', 'pseudo', 'prose', 'orphan-candidate.json');
      writeRawJSON(jsonPath, makeV3(crossPath));
      const out = await readProseFile(jsonPath, root);
      expect(out).not.toBeNull();
      // readProseFile's self-heal swallows the throw — file field stays as-is
      // so migration can see it and route to _orphan/
      expect(out!.file).toBe(crossPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no-op when project param is omitted', async () => {
    const root = makeProject();
    try {
      const abs = join(root, 'src', 'foo.ts');
      const jsonPath = join(root, '.collab', 'pseudo', 'prose', 'noproj.json');
      writeRawJSON(jsonPath, makeV3(abs));
      const out = await readProseFile(jsonPath);
      expect(out).not.toBeNull();
      expect(out!.file).toBe(abs); // unchanged
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// migrateProseFilesToRelative
// ---------------------------------------------------------------------------

describe('migrateProseFilesToRelative', () => {
  it('rewrites absolute in-project ProseFileV3 to rel, moves on-disk file to mirrored path', async () => {
    const root = makeProject();
    try {
      const abs = join(root, 'src', 'foo.ts');
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      // Legacy on-disk layout: escaped absolute path under prose/.
      // Use a predictable filename that's clearly "not rel".
      const oldPath = join(proseDir, 'legacy-absolute.json');
      writeRawJSON(oldPath, makeV3(abs));

      const report = await migrateProseFilesToRelative(root);
      expect(report.migrated).toBe(1);
      expect(report.orphaned).toBe(0);
      expect(report.errors.length).toBe(0);

      // Old legacy file should be gone.
      expect(existsSync(oldPath)).toBe(false);

      // New file should live at the mirrored rel path.
      const expectedNew = join(proseDir, escapePath('src/foo.ts') + '.json');
      expect(existsSync(expectedNew)).toBe(true);

      // JSON should have rel POSIX in `file`.
      const parsed = JSON.parse(readFileSync(expectedNew, 'utf8')) as ProseFileV3;
      expect(parsed.file).toBe('src/foo.ts');
      expect(parsed.schema_version).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves cross-machine prose (../../Users/...) to _orphan/', async () => {
    const root = makeProject();
    try {
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const oldPath = join(proseDir, 'cross-machine.json');
      writeRawJSON(oldPath, makeV3('/Users/someone/unrelated/path/foo.ts'));

      const report = await migrateProseFilesToRelative(root);
      expect(report.orphaned).toBe(1);
      expect(report.migrated).toBe(0);
      expect(report.errors.length).toBe(0);

      // Original gone, moved under _orphan/.
      expect(existsSync(oldPath)).toBe(false);
      const orphanPath = join(proseDir, '_orphan', 'cross-machine.json');
      expect(existsSync(orphanPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers cross-machine absolute path by suffix match when target exists in project', async () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, 'src', 'services'), { recursive: true });
      writeFileSync(join(root, 'src', 'services', 'scanner.ts'), '// real file\n');

      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const oldPath = join(proseDir, 'scanner.json');
      writeRawJSON(oldPath, makeV3('/Users/other/Code/proj/src/services/scanner.ts'));

      const report = await migrateProseFilesToRelative(root);
      expect(report.migrated).toBe(1);
      expect(report.orphaned).toBe(0);

      const newPath = join(proseDir, 'src', 'services', 'scanner.ts.json');
      expect(existsSync(newPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(newPath, 'utf8')) as ProseFileV3;
      expect(parsed.file).toBe('src/services/scanner.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers files previously quarantined in _orphan/ when suffix now matches', async () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, 'src', 'services'), { recursive: true });
      writeFileSync(join(root, 'src', 'services', 'scanner.ts'), '// real file\n');

      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const orphanPath = join(proseDir, '_orphan', 'scanner.json');
      writeRawJSON(orphanPath, makeV3('/Users/other/Code/proj/src/services/scanner.ts'));

      const report = await migrateProseFilesToRelative(root);
      expect(report.migrated).toBe(1);
      expect(report.orphaned).toBe(0);

      expect(existsSync(orphanPath)).toBe(false);
      const newPath = join(proseDir, 'src', 'services', 'scanner.ts.json');
      expect(existsSync(newPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no-op when sentinel .migrated-rel exists', async () => {
    const root = makeProject();
    try {
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const oldPath = join(proseDir, 'legacy-absolute.json');
      const abs = join(root, 'src', 'foo.ts');
      writeRawJSON(oldPath, makeV3(abs));

      // Pre-write sentinel; migration should early-return without touching file.
      writeFileSync(join(root, '.collab', 'pseudo', '.migrated-rel'), '{}');

      const report = await migrateProseFilesToRelative(root);
      expect(report.migrated).toBe(0);
      expect(report.orphaned).toBe(0);
      expect(report.skipped).toBe(0);

      // Old file still there untouched.
      expect(existsSync(oldPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(oldPath, 'utf8')) as ProseFileV3;
      expect(parsed.file).toBe(abs);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('idempotent — repeated invocation returns zero counts', async () => {
    const root = makeProject();
    try {
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const abs = join(root, 'src', 'foo.ts');
      writeRawJSON(join(proseDir, 'legacy-absolute.json'), makeV3(abs));

      const first = await migrateProseFilesToRelative(root);
      expect(first.migrated).toBe(1);

      const second = await migrateProseFilesToRelative(root);
      expect(second.migrated).toBe(0);
      expect(second.orphaned).toBe(0);
      expect(second.skipped).toBe(0);
      expect(second.errors.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips already-rel prose files', async () => {
    const root = makeProject();
    try {
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      const relPath = 'src/foo.ts';
      const targetPath = join(proseDir, escapePath(relPath) + '.json');
      writeRawJSON(targetPath, makeV3(relPath));

      const report = await migrateProseFilesToRelative(root);
      expect(report.migrated).toBe(0);
      expect(report.orphaned).toBe(0);
      expect(report.skipped).toBe(1);
      expect(report.errors.length).toBe(0);

      // File still there, untouched.
      expect(existsSync(targetPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(targetPath, 'utf8')) as ProseFileV3;
      expect(parsed.file).toBe(relPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves broken / non-ProseFileV3 JSON (does not crash)', async () => {
    const root = makeProject();
    try {
      const proseDir = join(root, '.collab', 'pseudo', 'prose');
      // Broken JSON (will throw on parse in readProseFile → goes to errors)
      writeFileSync(join(proseDir, 'broken.json'), '{not: "valid json",,', 'utf8');
      // Valid JSON but wrong schema (schema_version != 3) → readProseFile validator throws
      writeRawJSON(join(proseDir, 'wrong-schema.json'), { schema_version: 99, foo: 'bar' });

      const report = await migrateProseFilesToRelative(root);

      // Both were recorded as errors (readProseFile throws) — neither migrated nor orphaned.
      expect(report.migrated).toBe(0);
      expect(report.orphaned).toBe(0);
      expect(report.errors.length).toBe(2);

      // Files preserved on disk.
      expect(existsSync(join(proseDir, 'broken.json'))).toBe(true);
      expect(existsSync(join(proseDir, 'wrong-schema.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// pseudo_upsert_prose normalizes absolute input.file
// ---------------------------------------------------------------------------

describe('pseudo_upsert_prose normalizes absolute input.file', () => {
  it('writes under rel-path filename, stores rel path in ProseFileV3.file', async () => {
    const root = makeProject();
    try {
      const abs = join(root, 'src', 'foo.ts');

      const result = await pseudo_upsert_prose(root, {
        file: abs,
        origin: 'manual',
        title: 't',
        purpose: 'p',
        module_context: 'm',
        methods: [
          {
            name: 'fn',
            enclosing_class: null,
            normalized_params: '',
            steps: [{ order: 0, content: 'hello' }],
          },
        ],
      });

      // Stored path should mirror the rel POSIX under prose/.
      const expected = join(root, '.collab', 'pseudo', 'prose', escapePath('src/foo.ts') + '.json');
      expect(result.prose_file_path).toBe(expected);
      expect(existsSync(expected)).toBe(true);

      // And in the JSON, `file` should be rel POSIX, not absolute.
      const parsed = JSON.parse(readFileSync(expected, 'utf8')) as ProseFileV3;
      expect(parsed.file).toBe('src/foo.ts');
      expect(parsed.methods.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
