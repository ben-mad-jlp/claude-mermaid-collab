/**
 * Pseudo Overlay — hierarchical prose→source method matcher.
 * 6-level fallback chain produces MatchQuality metadata per attachment.
 */

import { dirname } from 'node:path';
import type { ProseFileV3, ProseMethod } from './pseudo-prose-file.js';

export type MatchQuality =
  | 'exact'
  | 'param_mismatch'
  | 'class_mismatch'
  | 'fuzzy_rename'
  | 'fuzzy_move'
  | 'orphan';

export interface SourceMethodRow {
  id: string;
  file_path: string;
  enclosing_class: string | null;
  name: string;
  normalized_params: string;
  body_fingerprint: string;
}

export interface FuzzyMatch {
  source: SourceMethodRow;
  score: number;
  reason: string;
}

export interface OverlayResult {
  attachedProse: Map<string, ProseMethod>;
  matches: Array<{ method_row_id: string; quality: MatchQuality; warning?: string }>;
  orphans: Array<{ prose_file: string; prose_method: ProseMethod; suggestions: FuzzyMatch[] }>;
}

function normPath(p: string): string {
  return p.replaceAll('\\', '/');
}

interface Indices {
  byId: Map<string, SourceMethodRow>;
  byFile: Map<string, SourceMethodRow[]>;
  byFingerprint: Map<string, SourceMethodRow[]>;
}

function buildIndices(sourceMethods: SourceMethodRow[]): Indices {
  const byId = new Map<string, SourceMethodRow>();
  const byFile = new Map<string, SourceMethodRow[]>();
  const byFingerprint = new Map<string, SourceMethodRow[]>();

  for (const row of sourceMethods) {
    byId.set(row.id, row);

    const fileKey = normPath(row.file_path);
    let bucket = byFile.get(fileKey);
    if (!bucket) { bucket = []; byFile.set(fileKey, bucket); }
    bucket.push(row);

    if (row.body_fingerprint) {
      let fp = byFingerprint.get(row.body_fingerprint);
      if (!fp) { fp = []; byFingerprint.set(row.body_fingerprint, fp); }
      fp.push(row);
    }
  }

  return { byId, byFile, byFingerprint };
}

function classMatches(row: SourceMethodRow, prose: ProseMethod): boolean {
  return (row.enclosing_class ?? null) === (prose.enclosing_class ?? null);
}

function step1ById(idx: Indices, prose: ProseMethod): SourceMethodRow | null {
  return idx.byId.get(prose.id) ?? null;
}

function step2ExactInFile(bucket: SourceMethodRow[], prose: ProseMethod): SourceMethodRow | null {
  for (const row of bucket) {
    if (classMatches(row, prose) && row.name === prose.name && row.normalized_params === prose.normalized_params) return row;
  }
  return null;
}

function step3ParamMismatch(bucket: SourceMethodRow[], prose: ProseMethod): SourceMethodRow | null {
  for (const row of bucket) {
    if (classMatches(row, prose) && row.name === prose.name) return row;
  }
  return null;
}

function step4NameOnly(bucket: SourceMethodRow[], prose: ProseMethod): SourceMethodRow | null {
  for (const row of bucket) {
    if (row.name === prose.name) return row;
  }
  return null;
}

function step5FingerprintInFile(bucket: SourceMethodRow[], prose: ProseMethod): SourceMethodRow | null {
  if (!prose.body_fingerprint) return null;
  for (const row of bucket) {
    if (row.body_fingerprint && row.body_fingerprint === prose.body_fingerprint) return row;
  }
  return null;
}

function step6FingerprintGlobal(idx: Indices, prose: ProseMethod, claimed: Set<string>): SourceMethodRow | null {
  if (!prose.body_fingerprint) return null;
  const candidates = idx.byFingerprint.get(prose.body_fingerprint);
  if (!candidates || candidates.length === 0) return null;
  for (const c of candidates) {
    if (!claimed.has(c.id)) return c;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function fuzzySuggestions(
  proseFilePath: string,
  prose: ProseMethod,
  sourceMethods: SourceMethodRow[],
): FuzzyMatch[] {
  const proseDir = dirname(normPath(proseFilePath));
  const candidates: FuzzyMatch[] = [];

  for (const row of sourceMethods) {
    const rowDir = dirname(normPath(row.file_path));
    if (rowDir !== proseDir) continue;

    const nameSim = nameSimilarity(prose.name, row.name);
    const fpHit = !!prose.body_fingerprint && prose.body_fingerprint === row.body_fingerprint;

    const score = Math.min(1, nameSim * 0.7 + (fpHit ? 0.3 : 0));
    if (score <= 0) continue;

    const reasonParts: string[] = [];
    reasonParts.push(`name~${nameSim.toFixed(2)}`);
    if (fpHit) reasonParts.push('fingerprint match');
    candidates.push({ source: row, score, reason: reasonParts.join(', ') });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3);
}

function warningFor(quality: MatchQuality, prose: ProseMethod, row: SourceMethodRow): string | undefined {
  switch (quality) {
    case 'param_mismatch':
      return `param signature drift: prose '${prose.normalized_params}' vs source '${row.normalized_params}'`;
    case 'class_mismatch':
      return `enclosing class drift: prose '${prose.enclosing_class ?? '<none>'}' vs source '${row.enclosing_class ?? '<none>'}'`;
    case 'fuzzy_rename':
      return `likely rename within file: prose '${prose.name}' -> source '${row.name}'`;
    case 'fuzzy_move':
      return `likely move across files: matched by body fingerprint`;
    default:
      return undefined;
  }
}

export function overlayProseOnMethods(
  proseFiles: Map<string, ProseFileV3>,
  sourceMethods: SourceMethodRow[],
): OverlayResult {
  const idx = buildIndices(sourceMethods);

  const attachedProse = new Map<string, ProseMethod>();
  const matches: OverlayResult['matches'] = [];
  const orphans: OverlayResult['orphans'] = [];

  const claimed = new Set<string>();

  for (const [proseFilePath, proseFile] of proseFiles) {
    const fileKey = normPath(proseFile.file);
    const bucket = idx.byFile.get(fileKey) ?? [];

    for (const prose of proseFile.methods) {
      let row: SourceMethodRow | null = null;
      let quality: MatchQuality = 'orphan';

      row = step1ById(idx, prose);
      if (row) quality = 'exact';

      if (!row) {
        row = step2ExactInFile(bucket, prose);
        if (row) quality = 'exact';
      }

      if (!row) {
        row = step3ParamMismatch(bucket, prose);
        if (row) quality = 'param_mismatch';
      }

      if (!row) {
        row = step4NameOnly(bucket, prose);
        if (row) quality = 'class_mismatch';
      }

      if (!row) {
        row = step5FingerprintInFile(bucket, prose);
        if (row) quality = 'fuzzy_rename';
      }

      if (!row) {
        row = step6FingerprintGlobal(idx, prose, claimed);
        if (row) quality = 'fuzzy_move';
      }

      if (!row || claimed.has(row.id)) {
        orphans.push({
          prose_file: proseFilePath,
          prose_method: prose,
          suggestions: fuzzySuggestions(proseFilePath, prose, sourceMethods),
        });
        continue;
      }

      claimed.add(row.id);
      attachedProse.set(row.id, prose);
      matches.push({
        method_row_id: row.id,
        quality,
        warning: warningFor(quality, prose, row),
      });
    }
  }

  return { attachedProse, matches, orphans };
}
