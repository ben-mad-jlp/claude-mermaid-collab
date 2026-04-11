/**
 * Pseudo Path Escape
 *
 * Windows-safe path encoding for prose files committed under .collab/pseudo/prose/.
 * - Reserved basenames (CON, PRN, ...) get an underscore suffix.
 * - Forbidden characters (<>:"|?*) are replaced with '_'.
 * - Trailing dots/spaces (disallowed on Windows) are replaced with '_'.
 * - When any escape occurs, a short SHA1 collision suffix is added to the final
 *   segment to prevent collisions between two distinct source paths.
 *
 * Pure and synchronous. _path_map.json sidecar writing is the caller's concern.
 */

import { createHash } from 'node:crypto';

export interface PathMap {
  [escaped: string]: string;
}

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const FORBIDDEN_CHARS = /[<>:"|?*\x00-\x1f]/g;

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}

export function isReservedWindowsName(basename: string): boolean {
  const dot = basename.indexOf('.');
  const stem = dot >= 0 ? basename.slice(0, dot) : basename;
  return RESERVED_NAMES.has(stem.toUpperCase());
}

function escapeSegment(segment: string): { escaped: string; changed: boolean } {
  if (segment.length === 0 || segment === '.' || segment === '..') {
    return { escaped: segment, changed: false };
  }

  let changed = false;
  let out = segment.replace(FORBIDDEN_CHARS, () => {
    changed = true;
    return '_';
  });

  const trailingMatch = out.match(/[. ]+$/);
  if (trailingMatch) {
    out = out.slice(0, out.length - trailingMatch[0].length) + '_'.repeat(trailingMatch[0].length);
    changed = true;
  }

  if (isReservedWindowsName(out)) {
    const dot = out.indexOf('.');
    if (dot >= 0) {
      out = out.slice(0, dot) + '_' + out.slice(dot);
    } else {
      out = out + '_';
    }
    changed = true;
  }

  return { escaped: out, changed };
}

export function escapePath(sourcePath: string): string {
  const segments = sourcePath.split(/[\\/]/);
  const results = segments.map(escapeSegment);
  const anyChanged = results.some((r) => r.changed);

  if (!anyChanged) {
    return sourcePath.replace(/\\/g, '/');
  }

  const escapedSegments = results.map((r) => r.escaped);
  const last = escapedSegments[escapedSegments.length - 1];
  const hash = shortHash(sourcePath);

  let newLast: string;
  const lastDot = last.lastIndexOf('.');
  if (lastDot > 0) {
    newLast = last.slice(0, lastDot) + '.' + hash + last.slice(lastDot);
  } else {
    newLast = last + '.' + hash;
  }
  escapedSegments[escapedSegments.length - 1] = newLast;
  return escapedSegments.join('/');
}

export function unescapePath(escaped: string, map?: PathMap): string {
  if (map && escaped in map) {
    return map[escaped];
  }
  let result = escaped;
  result = result.replace(/\.[0-9a-f]{8}(\.[^.\/]+)?$/, (_, ext) => ext ?? '');
  const segments = result.split('/');
  const last = segments[segments.length - 1];
  if (last.endsWith('_')) {
    const stripped = last.slice(0, -1);
    if (isReservedWindowsName(stripped)) {
      segments[segments.length - 1] = stripped;
    } else {
      const dotStripped = last.indexOf('.');
      if (dotStripped > 0) {
        const stem = last.slice(0, dotStripped);
        const rest = last.slice(dotStripped);
        if (stem.endsWith('_') && isReservedWindowsName(stem.slice(0, -1))) {
          segments[segments.length - 1] = stem.slice(0, -1) + rest;
        }
      }
    }
  }
  return segments.join('/');
}
