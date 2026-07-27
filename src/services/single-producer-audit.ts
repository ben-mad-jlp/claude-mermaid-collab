import fs from 'node:fs';
import path from 'node:path';

export type AuditCorpus = Map<string, string>;

export interface AuditHit {
  file: string;
  line: number;
  text: string;
}

export interface AuditResult {
  hits: AuditHit[];
}

const TERMINAL_PREFIX_EXEMPT_SYMBOLS = new Set(['isMissionTerminal']);
// isMissionTerminal (mission-store.ts:49) is a boolean terminality test, not the prefix producer — it returns boolean and only compares against status literals

export function loadSrcCorpus(repoRoot: string): AuditCorpus {
  const corpus = new Map<string, string>();
  const srcDir = path.join(repoRoot, 'src');

  if (!fs.existsSync(srcDir)) {
    return corpus;
  }

  function walkDir(dir: string) {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      // Skip __tests__ directories (exact segment match)
      if (entry.name === '__tests__') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      ) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const relPath = path
          .relative(repoRoot, fullPath)
          .split(path.sep)
          .join('/');
        corpus.set(relPath, content);
      }
    }
  }

  walkDir(srcDir);
  return corpus;
}

function sortHits(hits: AuditHit[]): AuditHit[] {
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function isCommentLine(trimmedLine: string): boolean {
  return trimmedLine.startsWith('//') || trimmedLine.startsWith('*');
}

export function findLandednessProducers(corpus: AuditCorpus): AuditResult {
  const hits = new Map<string, AuditHit>();
  const compoundPattern =
    /status\s*===\s*'done'\s*\|\|[^\n]*landedAt\s*!==?\s*null/;
  const barePattern = /landedAt\s*!==?\s*null/;

  for (const file of [...corpus.keys()].sort()) {
    const text = corpus.get(file)!;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check both patterns
      if (compoundPattern.test(line) || barePattern.test(line)) {
        const key = `${file}:${i + 1}`;
        if (!hits.has(key)) {
          hits.set(key, { file, line: i + 1, text: trimmed });
        }
      }
    }
  }

  return { hits: sortHits([...hits.values()]) };
}

export function findTerminalPrefixProducers(corpus: AuditCorpus): AuditResult {
  const hits: AuditHit[] = [];
  const functionDeclPattern =
    /^\s*(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

  for (const file of [...corpus.keys()].sort()) {
    const text = corpus.get(file)!;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = functionDeclPattern.exec(line);

      if (match) {
        const functionName = match[3];

        // Skip exempt symbols
        if (TERMINAL_PREFIX_EXEMPT_SYMBOLS.has(functionName)) {
          continue;
        }

        // Collect bounded window (next '}' at column 0 or 200 lines)
        let windowEnd = Math.min(i + 200, lines.length);
        for (let j = i + 1; j < Math.min(i + 200, lines.length); j++) {
          if (lines[j] === '}') {
            windowEnd = j;
            break;
          }
        }

        const window = lines.slice(i, windowEnd + 1).join('\n');

        // Check for all three return statements
        const hasClosedReturn = /return\s+'closed'/.test(window);
        const hasAbandonedReturn = /return\s+'abandoned'/.test(window);
        const hasUnapprovedReturn = /return\s+'unapproved'/.test(window);

        if (hasClosedReturn && hasAbandonedReturn && hasUnapprovedReturn) {
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
  }

  return { hits: sortHits(hits) };
}

export function findContainerCloseProducers(corpus: AuditCorpus): AuditResult {
  const hits: AuditHit[] = [];
  const updatePattern = /UPDATE\s+todos\s+SET\s+status='done'/;
  const acceptancePattern = /acceptanceStatus='accepted'/;

  for (const file of [...corpus.keys()].sort()) {
    const text = corpus.get(file)!;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comment lines
      if (isCommentLine(trimmed)) {
        continue;
      }

      // Require both patterns on same line
      if (updatePattern.test(line) && acceptancePattern.test(line)) {
        hits.push({ file, line: i + 1, text: trimmed });
      }
    }
  }

  return { hits: sortHits(hits) };
}

export function findLandRecordCaptureProducers(
  corpus: AuditCorpus
): AuditResult {
  const hits: AuditHit[] = [];
  const capturePattern =
    /export\s+(?:async\s+)?function\s+captureLandCycleFields\s*\(/;

  for (const file of [...corpus.keys()].sort()) {
    const text = corpus.get(file)!;
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (capturePattern.test(line)) {
        hits.push({ file, line: i + 1, text: line.trim() });
      }
    }
  }

  return { hits: sortHits(hits) };
}

export function renderAuditReport(corpus: AuditCorpus): string {
  const sections = [
    {
      title: 'Landedness Producers',
      result: findLandednessProducers(corpus),
    },
    {
      title: 'Terminal Prefix Producers',
      result: findTerminalPrefixProducers(corpus),
    },
    {
      title: 'Container Close Producers',
      result: findContainerCloseProducers(corpus),
    },
    {
      title: 'Land Record Capture Producers',
      result: findLandRecordCaptureProducers(corpus),
    },
  ];

  const lines: string[] = [];

  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push(`Count: ${section.result.hits.length}`);

    for (const hit of section.result.hits) {
      lines.push(`- ${hit.file}:${hit.line} — ${hit.text}`);
    }

    lines.push(''); // blank line between sections
  }

  // Remove trailing blank line and join with newlines, then add single final newline
  return lines.slice(0, -1).join('\n') + '\n';
}
