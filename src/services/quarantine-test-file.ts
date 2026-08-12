import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ResolveTestFileDeps {
  listTestFiles?: (projectRoot: string) => string[];
  readFile?: (projectRoot: string, rel: string) => string;
}

interface CacheEntry {
  files: string[];
  contents: Map<string, string>;
}

const cache = new Map<string, CacheEntry>();

export function resetQuarantineTestFileCache(): void {
  cache.clear();
}

function listTestFilesDefault(projectRoot: string): string[] {
  const files: string[] = [];

  function walkDir(dir: string, relBase: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'out' ||
          entry.name === '.git' ||
          entry.name === 'coverage' ||
          entry.name === 'quarantine'
        ) {
          continue;
        }

        const fullPath = join(dir, entry.name);
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (
          entry.name.endsWith('.test.ts') ||
          entry.name.endsWith('.test.tsx') ||
          entry.name.endsWith('.spec.ts') ||
          entry.name.endsWith('.spec.tsx')
        ) {
          files.push(relPath);
        }
      }
    } catch (err) {
      // Silently ignore walk errors
    }
  }

  try {
    walkDir(join(projectRoot, 'src'), 'src');
  } catch (err) {
    // Silently ignore
  }
  try {
    walkDir(join(projectRoot, 'ui', 'src'), 'ui/src');
  } catch (err) {
    // Silently ignore
  }

  return files;
}

function readFileDefault(projectRoot: string, rel: string): string {
  try {
    return readFileSync(join(projectRoot, rel), 'utf-8');
  } catch (err) {
    return '';
  }
}

export function resolveQuarantineTestFile(
  projectRoot: string,
  test: string,
  deps?: ResolveTestFileDeps,
): string | null {
  const listTestFilesFn = deps?.listTestFiles ?? listTestFilesDefault;
  const readFileFn = deps?.readFile ?? readFileDefault;

  // Step 0: strip counter prefix
  const stripped = test.replace(/^\(\d+\/\d+\)\s*/, '');

  // Step 1: path already present
  const pathMatch = stripped.match(/((?:src|ui)\/[^\s:>,]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Get or populate cache
  let entry = cache.get(projectRoot);
  if (!entry) {
    let files: string[] = [];
    try {
      files = listTestFilesFn(projectRoot);
    } catch (err) {
      return null;
    }
    const contents = new Map<string, string>();
    for (const file of files) {
      let content = '';
      try {
        content = readFileFn(projectRoot, file);
      } catch (err) {
        // Silently degrade to empty string
      }
      contents.set(file, content);
    }
    entry = { files, contents };
    cache.set(projectRoot, entry);
  }

  // Step 2: literal scan
  const segments = stripped.split(' > ');
  let leadingSegment = segments[0];
  let finalSegment = segments[segments.length - 1];

  function scanFiles(segment: string): string | null {
    let matches: string[] = [];
    for (const file of entry!.files) {
      const content = entry!.contents.get(file) ?? '';
      if (content.indexOf(segment) !== -1) {
        matches.push(file);
      }
    }
    if (matches.length === 1) return matches[0];
    return null;
  }

  let resolved = scanFiles(leadingSegment);
  if (resolved !== null) return resolved;

  resolved = scanFiles(finalSegment);
  if (resolved !== null) return resolved;

  // Step 3: arrow-variant retry
  function swapArrow(text: string): string {
    if (text.includes('->')) return text.replace(/->/g, '→');
    if (text.includes('→')) return text.replace(/→/g, '->');
    return text;
  }

  const leadingAlt = swapArrow(leadingSegment);
  if (leadingAlt !== leadingSegment) {
    resolved = scanFiles(leadingAlt);
    if (resolved !== null) return resolved;
  }

  const finalAlt = swapArrow(finalSegment);
  if (finalAlt !== finalSegment) {
    resolved = scanFiles(finalAlt);
    if (resolved !== null) return resolved;
  }

  return null;
}
