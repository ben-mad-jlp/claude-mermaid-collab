/**
 * Pseudo Ctags — opt-in complement scanner using universal-ctags.
 * Detects ctags, runs JSON output for Go/Rust/Java/Kotlin/Ruby, maps to StructuralMethod.
 * Graceful fallback on absence.
 */

import { spawn } from 'child_process';
import type { StructuralMethod } from './source-scanner.js';

export interface CtagsAvailability {
  available: boolean;
  version?: string;
  isUniversal: boolean;
  error?: string;
}

export interface CtagsScanOptions {
  signal?: AbortSignal;
  extensions?: Set<string>;
}

const DEFAULT_CTAGS_EXTS: ReadonlySet<string> = new Set([
  '.go', '.rs', '.java', '.kt', '.kts', '.rb',
]);

const CTAGS_LANGUAGES = 'Go,Rust,Java,Kotlin,Ruby';
const MAX_FILES_PER_BATCH = 200;
const DETECT_TIMEOUT_MS = 5_000;
const SCAN_TIMEOUT_MS = 60_000;

interface CtagsJsonTag {
  _type?: string;
  name: string;
  path: string;
  pattern?: string;
  line?: number;
  end?: number;
  kind?: string;
  scope?: string;
  scopeKind?: string;
  access?: string;
  signature?: string;
  typeref?: string;
  language?: string;
}

const FUNCTION_KINDS: ReadonlySet<string> = new Set([
  'function', 'func', 'method', 'singletonMethod', 'constructor',
]);

export async function detectCtags(): Promise<CtagsAvailability> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: CtagsAvailability) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc;
    try {
      proc = spawn('ctags', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ available: false, isUniversal: false, error: (err as Error).message });
      return;
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      finish({ available: false, isUniversal: false, error: 'ctags --version timed out' });
    }, DETECT_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish({
        available: false,
        isUniversal: false,
        error: err.code === 'ENOENT' ? 'ctags binary not found in PATH' : err.message,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish({
          available: false,
          isUniversal: false,
          error: stderr.trim() || `ctags --version exited with code ${code}`,
        });
        return;
      }
      const firstLine = stdout.split('\n', 1)[0] ?? '';
      const isUniversal = /Universal Ctags/i.test(firstLine);
      const m1 = stdout.match(/Universal Ctags (\d+\.\d+\.\d+)/);
      const m2 = stdout.match(/Version[: ]+([\d.]+)/i);
      const version = m1?.[1] ?? m2?.[1];
      finish({ available: true, isUniversal, version });
    });
  });
}

export async function scanFilesWithCtags(
  absPaths: string[],
  opts: CtagsScanOptions = {},
): Promise<Map<string, StructuralMethod[]>> {
  const exts = opts.extensions ?? DEFAULT_CTAGS_EXTS;
  const result = new Map<string, StructuralMethod[]>();

  const filtered = absPaths.filter((p) => {
    const lower = p.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot < 0) return false;
    return exts.has(lower.slice(dot));
  });
  if (filtered.length === 0) return result;

  if (opts.signal?.aborted) return result;

  for (let i = 0; i < filtered.length; i += MAX_FILES_PER_BATCH) {
    if (opts.signal?.aborted) break;
    const batch = filtered.slice(i, i + MAX_FILES_PER_BATCH);
    try {
      const partial = await runCtagsBatch(batch, opts.signal);
      for (const [k, v] of partial) {
        const existing = result.get(k);
        if (existing) existing.push(...v);
        else result.set(k, v);
      }
    } catch (err) {
      console.warn(`[pseudo-ctags] batch failed (${batch.length} files): ${(err as Error).message}`);
    }
  }

  return result;
}

function runCtagsBatch(
  paths: string[],
  signal?: AbortSignal,
): Promise<Map<string, StructuralMethod[]>> {
  return new Promise((resolve, reject) => {
    const args = [
      '--output-format=json',
      '--fields=+nKzSl',
      `--languages=${CTAGS_LANGUAGES}`,
      '-f', '-',
      ...paths,
    ];

    let proc;
    try {
      proc = spawn('ctags', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }

    const out = new Map<string, StructuralMethod[]>();
    let buffer = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      finish(() => reject(new Error('ctags scan timed out')));
    }, SCAN_TIMEOUT_MS);

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      finish(() => reject(new Error('ctags scan aborted')));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) ingestLine(line, out);
      }
    });

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      finish(() => reject(err));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (buffer.trim()) ingestLine(buffer.trim(), out);
      buffer = '';
      if (code !== 0) {
        finish(() => reject(new Error(stderr.trim() || `ctags exited with code ${code}`)));
        return;
      }
      finish(() => resolve(out));
    });
  });
}

function ingestLine(line: string, out: Map<string, StructuralMethod[]>): void {
  let json: CtagsJsonTag;
  try {
    json = JSON.parse(line) as CtagsJsonTag;
  } catch {
    return;
  }
  if (json._type !== 'tag') return;
  if (!json.name || !json.path) return;
  if (!isFunctionKind(json.kind)) return;

  const method = jsonTagToStructuralMethod(json);
  const existing = out.get(json.path);
  if (existing) existing.push(method);
  else out.set(json.path, [method]);
}

function jsonTagToStructuralMethod(json: CtagsJsonTag): StructuralMethod {
  const startLine = typeof json.line === 'number' ? json.line : 0;
  const endLine = typeof json.end === 'number' ? json.end : startLine;
  const rawParams = json.signature ?? '';
  return {
    name: json.name,
    enclosing_class: json.scope ?? null,
    start_line: startLine,
    end_line: endLine,
    normalized_params: parseSignature(rawParams),
    is_async: false,
    is_exported: deriveIsExported(json),
    raw_params: rawParams,
    body: '',
    call_edges: [],
  };
}

function parseSignature(sig: string): string {
  const trimmed = sig.trim().replace(/^\(|\)$/g, '').trim();
  if (!trimmed) return '';
  const segments = splitTopLevel(trimmed, ',');
  const types = segments.map(extractTypeToken).filter(Boolean);
  return types.join(', ');
}

function splitTopLevel(input: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: "'" | '"' | '`' | null = null;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === delim) {
      const seg = input.slice(start, i).trim();
      if (seg) out.push(seg);
      start = i + 1;
    }
  }
  const tail = input.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function extractTypeToken(segment: string): string {
  const colon = segment.indexOf(':');
  if (colon >= 0) return segment.slice(colon + 1).trim();
  const parts = segment.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return segment;
}

function deriveIsExported(json: CtagsJsonTag): boolean {
  if (json.access) {
    return json.access === 'public' || json.access === 'default';
  }
  if (json.language === 'Go') {
    const first = json.name.charAt(0);
    return first >= 'A' && first <= 'Z';
  }
  return true;
}

function isFunctionKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return FUNCTION_KINDS.has(kind);
}
