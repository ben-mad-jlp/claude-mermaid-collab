import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

/**
 * Graph↔code drift detection (PCS new-gap). DECISION: a deterministic
 * import-edge check, NOT an LLM call-graph (the design flagged semantic
 * call-graph analysis as the weakest/fuzziest idea). The common, real,
 * cheaply-detectable drift is a MISSING dependency: code in one plan node's
 * files imports another node's files, but the plan graph has no corresponding
 * dependsOn. We flag those. (A spurious-dependency check — depends-on with no
 * import relationship — is intentionally NOT flagged: non-code coupling is real
 * and would produce false positives.)
 *
 * The detector is pure (inputs injected) so it's unit-testable; the live scanner
 * (read files, extract + resolve imports) is best-effort I/O.
 */

export interface DriftNode {
  id: string;
  dependsOn: string[];
  files: string[];
  title?: string;
}

export interface ImportEdge { fromFile: string; toFile: string }

export interface DriftFinding {
  kind: 'missing-dependency';
  fromTodo: string;
  toTodo: string;
  via: { fromFile: string; toFile: string };
  detail: string;
}

/** Transitive dependsOn closure for a node id. */
function reachable(id: string, depsById: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(depsById.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const d of depsById.get(n) ?? []) stack.push(d);
  }
  return seen;
}

/** Pure: given plan nodes (id/files/dependsOn) and resolved file→file import
 *  edges, return missing-dependency findings (deduped per todo-pair). */
export function detectGraphDrift(nodes: DriftNode[], imports: ImportEdge[]): DriftFinding[] {
  const fileToNode = new Map<string, string>();
  for (const n of nodes) for (const f of n.files) if (!fileToNode.has(f)) fileToNode.set(f, n.id);
  const depsById = new Map(nodes.map((n) => [n.id, n.dependsOn ?? []]));
  const titleById = new Map(nodes.map((n) => [n.id, n.title ?? n.id]));

  const seenPair = new Set<string>();
  const findings: DriftFinding[] = [];
  for (const e of imports) {
    const from = fileToNode.get(e.fromFile);
    const to = fileToNode.get(e.toFile);
    if (!from || !to || from === to) continue;
    if (reachable(from, depsById).has(to)) continue; // already a (transitive) dep — fine
    const key = `${from}->${to}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    findings.push({
      kind: 'missing-dependency',
      fromTodo: from,
      toTodo: to,
      via: { fromFile: e.fromFile, toFile: e.toFile },
      detail: `"${titleById.get(from)}" imports code in "${titleById.get(to)}" (${e.fromFile} → ${e.toFile}) but has no dependsOn it.`,
    });
  }
  return findings;
}

/** Extract import/require specifiers from source text. */
export function extractImportSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:import\s[^;]*?from\s*|import\s*|export\s[^;]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

/** Resolve a RELATIVE import specifier (from `fromFile`) to one of `knownFiles`
 *  (repo-relative paths). Tries common extensions + index files. Returns null
 *  for unresolved / non-relative (alias/package) specifiers. Pure. */
export function resolveImport(fromFile: string, spec: string, knownFiles: Set<string>): string | null {
  if (!spec.startsWith('.')) return null; // package/alias — out of scope for the deterministic check
  const baseDir = dirname(fromFile);
  const target = normalize(join(baseDir, spec)).replace(/\\/g, '/');
  const candidates = [
    target,
    `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.jsx`,
    `${target}/index.ts`, `${target}/index.tsx`, `${target}/index.js`,
  ];
  for (const c of candidates) if (knownFiles.has(c)) return c;
  return null;
}

/**
 * Live scan: for plan nodes carrying `files`, read each file under `project`,
 * resolve its relative imports against the known file set, and run the drift
 * detector. Best-effort (unreadable files skipped). `nodes` come from the
 * blueprint task graph (tasks carry files + depends-on).
 */
export function checkGraphDrift(project: string, nodes: DriftNode[]): DriftFinding[] {
  const knownFiles = new Set<string>();
  for (const n of nodes) for (const f of n.files) knownFiles.add(f.replace(/\\/g, '/'));
  const edges: ImportEdge[] = [];
  for (const n of nodes) {
    for (const f of n.files) {
      const abs = join(project, f);
      if (!existsSync(abs)) continue;
      let src = '';
      try { src = readFileSync(abs, 'utf8'); } catch { continue; }
      for (const spec of extractImportSpecifiers(src)) {
        const resolved = resolveImport(f.replace(/\\/g, '/'), spec, knownFiles);
        if (resolved) edges.push({ fromFile: f.replace(/\\/g, '/'), toFile: resolved });
      }
    }
  }
  return detectGraphDrift(nodes, edges);
}
