#!/usr/bin/env bun
/**
 * bin/bootstrap-pseudo.ts
 *
 * Bulk-generate LLM prose for every source file lacking manual/llm prose by
 * invoking the `create_pseudocode` handler from ollama-coding-mcp directly —
 * no duplicated prompt or LLM plumbing. Persists each result by calling
 * `pseudo_upsert_prose` in-process (bypassing the collab HTTP API, which
 * has no POST handler for /api/pseudo/prose).
 *
 * Env:
 *   OLLAMA_URL              default http://localhost:11434
 *   OLLAMA_MCP_CHAT_MODEL   default qwen3-coder:30b (handler default)
 *   BOOTSTRAP_CONCURRENCY   default 4
 *   BOOTSTRAP_LIMIT         optional cap on files processed
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database } from 'bun:sqlite';

import { initPseudoDbV6 } from '../src/services/pseudo-db.js';
import { pseudo_upsert_prose } from '../src/mcp/tools/pseudo-upsert-prose.js';
import { escapePath, toRelPosixPath } from '../src/services/pseudo-path-escape.js';
import { createCreatePseudocodeTool } from '/srv/codebase/ai/ollama-coding-mcp/dist/tools/create_pseudocode.js';
import { OllamaClient } from '/srv/codebase/ai/ollama-coding-mcp/dist/lib/ollama.js';
import { PathSandbox } from '/srv/codebase/ai/ollama-coding-mcp/dist/lib/paths.js';

const CONCURRENCY = Math.max(1, Number(process.env.BOOTSTRAP_CONCURRENCY ?? 4));
const LIMIT = process.env.BOOTSTRAP_LIMIT ? Number(process.env.BOOTSTRAP_LIMIT) : Infinity;

interface ProseStep { order: number; content: string }
interface ProseMethodOut {
  name: string;
  enclosing_scope: string | null;
  normalized_params: string;
  steps: ProseStep[];
}
interface Pseudocode {
  title: string;
  purpose: string;
  module_context: string;
  methods: ProseMethodOut[];
}
interface HandlerOutput {
  ok: boolean;
  file: string;
  methods_written?: number;
  skipped_reason?: string;
  error?: string;
  persisted?: boolean;
  persist_error?: string;
  pseudocode?: Pseudocode;
}

/**
 * No-op collab client passed to the ollama tool. Skips the HTTP round-trip to
 * the mermaid-collab server (whose POST /api/pseudo/prose doesn't exist).
 * `hasExistingProse` returns false unconditionally — the bootstrap does its
 * own on-disk existence check before calling the tool, so this is safe.
 */
function noopCollabClient() {
  return {
    async hasExistingProse(): Promise<boolean> { return false; },
    async upsertProse(): Promise<unknown> { return { ok: true }; },
  };
}

function pickTargets(db: Database): string[] {
  // A file "has prose" when at least one method has prose_origin IN ('llm','manual').
  // Methods with prose_origin='heuristic' count as empty — they should be upgraded.
  const rows = db.prepare(`
    SELECT f.file_path,
           COUNT(mc.id) AS inbound,
           SUM(CASE WHEN m.prose_origin IN ('llm','manual') THEN 1 ELSE 0 END) AS real_prose
    FROM files f
    LEFT JOIN methods m ON m.file_path = f.file_path
    LEFT JOIN method_calls mc ON mc.callee_method_id = m.id
    WHERE f.stub = 0
    GROUP BY f.file_path
    HAVING COALESCE(real_prose, 0) = 0
    ORDER BY inbound DESC, f.file_path ASC
  `).all() as Array<{ file_path: string; inbound: number; real_prose: number }>;
  return rows.map((r) => r.file_path);
}

function proseFilePathFor(project: string, absOrRelFile: string): string {
  const rel = toRelPosixPath(project, absOrRelFile);
  return join(project, '.collab', 'pseudo', 'prose', escapePath(rel) + '.json');
}

async function persistResult(project: string, result: HandlerOutput): Promise<void> {
  if (!result.pseudocode) throw new Error('no pseudocode in result');
  await pseudo_upsert_prose(project, {
    file: result.file,
    title: result.pseudocode.title,
    purpose: result.pseudocode.purpose,
    module_context: result.pseudocode.module_context,
    origin: 'llm',
    methods: result.pseudocode.methods.map((m) => ({
      name: m.name,
      enclosing_class: m.enclosing_scope,
      normalized_params: m.normalized_params,
      steps: m.steps,
    })),
  });
}

async function main(): Promise<void> {
  const project = resolve(process.argv[2] ?? process.cwd());
  console.log(`[bootstrap] project=${project} concurrency=${CONCURRENCY}`);

  const handle = initPseudoDbV6(project, { attachWatcher: false, attachDrift: false });
  await handle.ready;

  const allTargets = pickTargets(handle.db);
  // Skip targets that already have a prose JSON on disk (e.g. from an earlier
  // partial run or manual authoring). The in-memory db may be stale here.
  const fresh = allTargets.filter((abs) => !existsSync(proseFilePathFor(project, abs)));
  const targets = fresh.slice(0, Math.min(fresh.length, LIMIT));
  console.log(
    `[bootstrap] ${targets.length} targets (skipping ${allTargets.length - fresh.length} with prose on disk, of ${allTargets.length} from db)`,
  );
  if (targets.length === 0) {
    await handle.dispose();
    return;
  }

  const tool = createCreatePseudocodeTool({
    client: new OllamaClient(),
    sandbox: new PathSandbox([project]),
    collab: noopCollabClient(),
  });

  const stats = { written: 0, skip: 0, fail: 0 };
  let cursor = 0;
  const started = Date.now();

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const idx = cursor++;
      const absPath = targets[idx];
      let result: HandlerOutput;
      try {
        const wrapped = await tool.handler({ project, file: absPath, force: true });
        const text = (wrapped as { content: Array<{ text: string }> }).content[0].text;
        result = JSON.parse(text) as HandlerOutput;
      } catch (err) {
        console.warn(`[bootstrap] ${absPath} threw:`, err);
        stats.fail++;
        continue;
      }

      if (result.ok && result.pseudocode) {
        try {
          await persistResult(project, result);
          stats.written++;
        } catch (err) {
          stats.fail++;
          console.warn(`[bootstrap] ${result.file}: persist failed: ${(err as Error).message}`);
        }
      } else if (result.skipped_reason) {
        stats.skip++;
      } else {
        stats.fail++;
        console.warn(`[bootstrap] ${result.file}: ${result.error ?? 'unknown failure'}`);
      }

      const done = stats.written + stats.skip + stats.fail;
      if (done % 5 === 0 || done === targets.length) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`[bootstrap] ${done}/${targets.length}  written=${stats.written} skip=${stats.skip} fail=${stats.fail}  ${elapsed}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[bootstrap] done. written=${stats.written} skip=${stats.skip} fail=${stats.fail}`);
  await handle.dispose();
}

main().catch((err) => {
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
