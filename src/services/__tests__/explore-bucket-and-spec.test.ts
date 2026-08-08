import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { openDb, getTodo, createTodo, _closeProject, type ExploreSpec } from '../todo-store';
import { ensureBucket, isBucketEpic, bucketTypeOfTitle } from '../bucket-registry';

describe('explore bucket type + persisted exploreSpec (leaf f0a7d968)', () => {
  let tmpDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'explore-bucket-'));
    projectPath = tmpDir;
    await fs.mkdir(join(projectPath, '.collab'), { recursive: true });
    openDb(projectPath); // create schema at current (post-migration) version
  });

  afterAll(() => {
    _closeProject(projectPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ensureBucket('explore') is idempotent and isBucketEpic recognizes the singleton", async () => {
    expect(bucketTypeOfTitle('Explore requests')).toBe('explore');

    const id1 = await ensureBucket(projectPath, 'explore');
    const id2 = await ensureBucket(projectPath, 'explore');
    expect(id2).toBe(id1);

    const bucketTodo = getTodo(projectPath, id1);
    expect(bucketTodo).toBeTruthy();
    expect(bucketTodo?.title).toBe('Explore requests');
    expect(bucketTodo?.bucketType).toBe('explore');
    expect(isBucketEpic(bucketTodo)).toBe(true);
  });

  test('a leaf created with a full exploreSpec round-trips field-by-field including not/reach nulls', async () => {
    const bucketId = await ensureBucket(projectPath, 'explore');
    const exploreSpec: ExploreSpec = {
      scope: 'src/services/bucket-registry.ts',
      target: 'ensureBucket dedupe behavior',
      oracle: 'ensureBucket called twice returns the same id',
      not: null,
      reach: null,
    };
    const created = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'Explore ensureBucket dedupe',
      kind: 'leaf',
      parentId: bucketId,
      exploreSpec,
    });

    expect(created.exploreSpec).toEqual(exploreSpec);

    const reread = getTodo(projectPath, created.id);
    expect(reread?.exploreSpec).toEqual(exploreSpec);
    expect(reread?.exploreSpec?.not).toBeNull();
    expect(reread?.exploreSpec?.reach).toBeNull();
  });

  test('a row created without exploreSpec reads exploreSpec === null', async () => {
    const bucketId = await ensureBucket(projectPath, 'explore');
    const created = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'Explore leaf with no spec',
      kind: 'leaf',
      parentId: bucketId,
    });

    expect(created.exploreSpec ?? null).toBeNull();

    const reread = getTodo(projectPath, created.id);
    expect(reread?.exploreSpec ?? null).toBeNull();
  });
});
