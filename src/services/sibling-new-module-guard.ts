/**
 * Guard against two sibling epics declaring the same new file.
 * `applyFoundationFirst` only de-conflicts leaves *within one* epic's spec. Two epics
 * planned minutes apart can each declare the same brand-new module; both build, both land,
 * collide at merge with add/add conflict. This guard runs at plan time on DECLARED state —
 * manifests and planned files — never by reading an epic worktree.
 */

import type { Todo } from './todo-store.js';
import type { DiffContract } from './diff-contract.js';
import { listTodos } from './todo-store.js';
import { isEpic } from './todo-kind.js';
import { parseDiffContract } from './diff-contract.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SiblingNewFile {
  epicId: string;
  path: string;
}

export interface SiblingNewModuleDeps {
  listTodos?: (project: string, opts?: { includeCompleted?: boolean }) => Todo[];
  restoreBlueprint?: (leafId: string) => string | null;
  parseContract?: (src: string) => DiffContract | null;
  existsOnTrunk?: (project: string, path: string) => boolean;
}

export class SiblingNewModuleCollisionError extends Error {
  constructor(
    readonly siblingEpicId: string,
    readonly path: string,
  ) {
    super(
      `plan_mission_criterion refused: ${path} is already declared as a new file by live sibling epic ${siblingEpicId.slice(0, 8)}`,
    );
    this.name = 'SiblingNewModuleCollisionError';
  }
}

/**
 * Enumerate live epics' leaves and collect {epicId, path} for files declared as new
 * (via filesToCreate or declaredFiles) that do not exist on trunk.
 *
 * Live = status is neither 'done' nor 'dropped'; skips the optional excludeEpicId.
 *
 * For each live epic and its child leaves:
 * 1. The DECLARED manifest is the FIRST of:
 *    - parseContract(restoreBlueprint(leaf.id)) → contract.filesToCreate
 *    - else the leaf todo's declaredFiles
 * 2. Keep only paths where existsOnTrunk(project, path) === false
 * 3. Dedupe by epicId|path
 *
 * Every step is individually try/caught: a throwing ledger read yields that leaf nothing;
 * a throwing listTodos yields []. The function never throws.
 */
export function collectSiblingDeclaredNewFiles(
  project: string,
  opts: { excludeEpicId?: string },
  deps?: SiblingNewModuleDeps,
): SiblingNewFile[] {
  const listTodosLive = deps?.listTodos ?? ((proj, opts) => listTodos(proj, opts));
  const restoreBlueprintLive = deps?.restoreBlueprint ?? ((leafId) => null);
  const parseContractLive = deps?.parseContract ?? ((src) => parseDiffContract(src));
  const existsOnTrunkLive = deps?.existsOnTrunk ?? ((proj, path) => existsSync(join(proj, path)));

  let allTodos: Todo[] = [];
  try {
    allTodos = listTodosLive(project, { includeCompleted: true });
  } catch {
    return [];
  }

  const result = new Map<string, SiblingNewFile>();

  for (const todo of allTodos) {
    // Only live epics (not done, not dropped)
    if (!isEpic(todo) || todo.status === 'done' || todo.status === 'dropped') continue;
    if (opts.excludeEpicId && todo.id === opts.excludeEpicId) continue;

    const epicId = todo.id;

    // Enumerate children (leaves with parentId === epic.id)
    for (const childTodo of allTodos) {
      if (childTodo.parentId !== epicId || childTodo.status === 'dropped') continue;

      const leafId = childTodo.id;
      const declaredFiles: string[] = [];

      // Try to get filesToCreate from blueprint contract
      try {
        const blueprint = restoreBlueprintLive(leafId);
        if (blueprint) {
          const contract = parseContractLive(blueprint);
          if (contract?.filesToCreate) {
            declaredFiles.push(...contract.filesToCreate);
          }
        }
      } catch {
        // Fall through to declaredFiles fallback
      }

      // If no filesToCreate, use declaredFiles fallback
      if (declaredFiles.length === 0 && childTodo.declaredFiles) {
        declaredFiles.push(...childTodo.declaredFiles);
      }

      // Keep only new files (absent from trunk)
      for (const path of declaredFiles) {
        try {
          if (!existsOnTrunkLive(project, path)) {
            const key = `${epicId}|${path}`;
            result.set(key, { epicId, path });
          }
        } catch {
          // Ignore and continue
        }
      }
    }
  }

  return Array.from(result.values());
}

/**
 * Assert that no spec leaf's declared files collide with sibling-declared new files.
 *
 * For every spec.leaves[].files entry, on the first match in siblingNewFiles,
 * throw SiblingNewModuleCollisionError naming both the sibling epic id (8-hex) and the path.
 */
export function assertNoSiblingNewModuleCollision(
  spec: { leaves: Array<{ files?: string[] }> },
  siblingNewFiles: SiblingNewFile[],
): void {
  const siblingSet = new Set(siblingNewFiles.map((f) => f.path));

  for (const leaf of spec.leaves) {
    if (!leaf.files) continue;
    for (const file of leaf.files) {
      const match = siblingNewFiles.find((f) => f.path === file);
      if (match) {
        throw new SiblingNewModuleCollisionError(match.epicId, file);
      }
    }
  }
}
