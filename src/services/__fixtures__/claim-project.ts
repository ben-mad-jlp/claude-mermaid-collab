/**
 * Test fixture: a real project directory whose consolidated database holds real `todos` rows.
 *
 * `leaf_claim.leafId` is `REFERENCES todos(id) ON DELETE CASCADE` and the opener turns foreign
 * keys ON, so a claim for a leaf that does not exist is REJECTED. That is the invariant the table
 * was created for — it is why the measured drift (todos saying 2 leaves running while the old
 * global `leaf_inflight` held 0 rows) cannot recur — and it means a test can no longer claim a
 * made-up id under a made-up project path like '/p'. Fixtures have to name a leaf that exists.
 */
import { mkdirSync } from 'node:fs';
import { openCollabDb } from '../collab-db';
import { canonicalProjectRootLoose } from '../store-paths';

/** Create (or extend) a project at `root` holding one `todos` row per id. Returns the CANONICAL
 *  root — on macOS a tmpdir path resolves through /private, and the claim store keys by the
 *  canonical form, so a test comparing project strings must use this and not its input. */
export function makeClaimProject(root: string, leafIds: string[]): string {
  mkdirSync(root, { recursive: true });
  const canon = canonicalProjectRootLoose(root);
  const db = openCollabDb(canon);
  const iso = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO todos (id, ownerSession, title, ord, createdAt, updatedAt, kind)
     VALUES (?, 'fixture', ?, 0, ?, ?, 'leaf')`,
  );
  for (const id of leafIds) ins.run(id, `leaf ${id}`, iso, iso);
  return canon;
}
