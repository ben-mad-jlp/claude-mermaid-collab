/**
 * pseudo_upsert_prose MCP tool — writes prose to .collab/pseudo/prose/<escaped>.json.
 * Required origin parameter. Diff-sanity check (reject if > 50% method drop).
 * In-process per-file mutex.
 */

import { join } from 'node:path';
import { initPseudoDbV6 } from '../../services/pseudo-db.js';
import {
  readProseFile,
  writeProseFile,
  type ProseFileV3,
  type ProseMethod,
} from '../../services/pseudo-prose-file.js';
import { escapePath, toRelPosixPath } from '../../services/pseudo-path-escape.js';
import { computeMethodId } from '../../services/pseudo-id.js';

const fileMutex = new Map<string, Promise<void>>();

async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileMutex.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  fileMutex.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileMutex.get(key) === gate) fileMutex.delete(key);
  }
}

export interface UpsertProseInput {
  file: string;
  title?: string;
  purpose?: string;
  module_context?: string;
  origin: 'manual' | 'llm';
  methods: Array<{
    id?: string;
    name: string;
    enclosing_class: string | null;
    normalized_params: string;
    body_fingerprint?: string;
    steps: Array<{ order: number; content: string }>;
    tags?: { deprecated?: boolean; since?: string };
  }>;
}

export interface UpsertProseResult {
  prose_file_path: string;
  methods_written: number;
  methods_preserved: number;
  warning?: string;
}

export async function pseudo_upsert_prose(
  project: string,
  input: UpsertProseInput,
): Promise<UpsertProseResult> {
  if (input.origin !== 'manual' && input.origin !== 'llm') {
    throw new Error(`pseudo_upsert_prose: origin must be 'manual' or 'llm'`);
  }
  if (!input.file) throw new Error(`pseudo_upsert_prose: file is required`);
  if (!Array.isArray(input.methods)) throw new Error(`pseudo_upsert_prose: methods array required`);

  input.file = toRelPosixPath(project, input.file);

  const escaped = escapePath(input.file);
  const proseFilePath = join(project, '.collab', 'pseudo', 'prose', escaped + '.json');

  return withFileLock(proseFilePath, async () => {
    const existing = await readProseFile(proseFilePath, project).catch(() => null);

    const existingMethodById = new Map<string, ProseMethod>();
    if (existing) {
      for (const m of existing.methods) existingMethodById.set(m.id, m);
    }

    const newMethods: ProseMethod[] = [];
    for (const m of input.methods) {
      const id = m.id ?? computeMethodId({
        file_path: input.file,
        enclosing_class: m.enclosing_class,
        name: m.name,
        normalized_params: m.normalized_params,
      });
      newMethods.push({
        id,
        name: m.name,
        enclosing_class: m.enclosing_class,
        normalized_params: m.normalized_params,
        body_fingerprint: m.body_fingerprint ?? 'h_empty___',
        prose_origin: input.origin,
        steps: m.steps.map((s) => ({ order: s.order, content: s.content })),
        tags: { deprecated: m.tags?.deprecated ?? false, ...(m.tags?.since ? { since: m.tags.since } : {}) },
      });
    }

    if (existing && existing.methods.length >= 4) {
      const droppedFraction = 1 - (newMethods.length / existing.methods.length);
      if (droppedFraction > 0.5) {
        throw new Error(
          `pseudo_upsert_prose: rejected — new payload drops ${(droppedFraction * 100).toFixed(0)}% of existing methods (${existing.methods.length} -> ${newMethods.length}). Pass explicit replace flag via a future option.`,
        );
      }
    }

    const newIds = new Set(newMethods.map((m) => m.id));
    let preservedCount = 0;
    if (existing) {
      for (const old of existing.methods) {
        if (!newIds.has(old.id)) {
          newMethods.push(old);
          preservedCount++;
        }
      }
    }

    const v3: ProseFileV3 = {
      schema_version: 3,
      file: input.file,
      title: input.title ?? existing?.title ?? '',
      purpose: input.purpose ?? existing?.purpose ?? '',
      module_context: input.module_context ?? existing?.module_context ?? '',
      methods: newMethods,
    };

    await writeProseFile(proseFilePath, v3);

    try {
      const handle = initPseudoDbV6(project);
      const absSource = join(project, input.file);
      handle.indexer
        .runIncrementalScanForFile(absSource, { trigger: 'manual' })
        .catch((err) => console.warn('[pseudo-upsert-prose] re-index failed:', err));
    } catch {}

    return {
      prose_file_path: proseFilePath,
      methods_written: input.methods.length,
      methods_preserved: preservedCount,
    };
  });
}
