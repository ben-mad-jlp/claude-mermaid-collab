/**
 * pseudo_reassign_prose / pseudo_reassign_prose_bulk — update prose entries
 * after a rename/move refactor, preserving ID stability.
 */

import { join } from 'node:path';
import { initPseudoDbV6 } from '../../services/pseudo-db.js';
import {
  readProseFile,
  writeProseFile,
  type ProseFileV3,
  type ProseMethod,
} from '../../services/pseudo-prose-file.js';
import { escapePath } from '../../services/pseudo-path-escape.js';

export interface ReassignMapping {
  file: string;
  old: {
    name: string;
    enclosing_class: string | null;
    normalized_params?: string;
  };
  new: {
    name: string;
    enclosing_class: string | null;
    normalized_params: string;
  };
}

export interface ReassignResult {
  updated: number;
  not_found: number;
  errors: Array<{ file: string; error: string }>;
}

async function applyOne(project: string, mapping: ReassignMapping): Promise<'updated' | 'not_found'> {
  const escaped = escapePath(mapping.file);
  const path = join(project, '.collab', 'pseudo', 'prose', escaped + '.json');
  const existing = await readProseFile(path, project);
  if (!existing) return 'not_found';

  let changed = false;
  const updated: ProseMethod[] = existing.methods.map((m) => {
    const nameMatch = m.name === mapping.old.name;
    const classMatch = (m.enclosing_class ?? null) === (mapping.old.enclosing_class ?? null);
    const paramMatch = mapping.old.normalized_params
      ? m.normalized_params === mapping.old.normalized_params
      : true;
    if (nameMatch && classMatch && paramMatch) {
      changed = true;
      return {
        ...m,
        name: mapping.new.name,
        enclosing_class: mapping.new.enclosing_class,
        normalized_params: mapping.new.normalized_params,
      };
    }
    return m;
  });

  if (!changed) return 'not_found';

  const next: ProseFileV3 = { ...existing, methods: updated };
  await writeProseFile(path, next);
  return 'updated';
}

export async function pseudo_reassign_prose(
  project: string,
  mapping: ReassignMapping,
): Promise<ReassignResult> {
  const result: ReassignResult = { updated: 0, not_found: 0, errors: [] };
  try {
    const outcome = await applyOne(project, mapping);
    if (outcome === 'updated') result.updated++;
    else result.not_found++;
  } catch (err) {
    result.errors.push({ file: mapping.file, error: err instanceof Error ? err.message : String(err) });
  }
  try {
    const handle = initPseudoDbV6(project);
    handle.indexer.runIncrementalScanForFile(mapping.file, { trigger: 'manual' }).catch(() => {});
  } catch {}
  return result;
}

export async function pseudo_reassign_prose_bulk(
  project: string,
  mappings: ReassignMapping[],
  confirm: boolean,
): Promise<ReassignResult> {
  if (!confirm) {
    throw new Error('pseudo_reassign_prose_bulk: confirm=true required for bulk operation');
  }
  const result: ReassignResult = { updated: 0, not_found: 0, errors: [] };
  for (const mapping of mappings) {
    try {
      const outcome = await applyOne(project, mapping);
      if (outcome === 'updated') result.updated++;
      else result.not_found++;
    } catch (err) {
      result.errors.push({ file: mapping.file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  try {
    const handle = initPseudoDbV6(project);
    const unique = Array.from(new Set(mappings.map((m) => m.file)));
    handle.indexer.runIncrementalScan(unique, { trigger: 'manual' }).catch(() => {});
  } catch {}
  return result;
}
