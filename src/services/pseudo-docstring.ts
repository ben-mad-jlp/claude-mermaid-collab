/**
 * Pseudo Docstring Extractor
 *
 * Per-language docstring extractors producing prose/steps/tags for each method.
 * Supported: JSDoc/TSDoc, PEP 257 (Google/NumPy flavors), C# XML doc, Doxygen.
 *
 * Attribution rule: a docstring must be within 2 lines of the method declaration.
 * Returns DocstringAmbiguity when attachment is unclear.
 */

export interface DocstringExtraction {
  title: string;
  purpose: string;
  steps: Array<{ order: number; content: string }>;
  tags: { deprecated?: boolean; since?: string };
}

export interface DocstringAmbiguity {
  kind: 'unattached' | 'multiple_candidates' | 'cross_method';
  message: string;
  lineRange: [number, number];
}

type MethodInfo = { name: string; start_line: number; end_line: number };
type ExtractResult = DocstringExtraction | DocstringAmbiguity;

const ATTACHMENT_MAX_GAP = 2;

function ambiguity(
  kind: DocstringAmbiguity['kind'],
  message: string,
  start: number,
  end: number,
): DocstringAmbiguity {
  return { kind, message, lineRange: [start, end] };
}

function makeExtraction(
  title: string,
  purposeLines: string[],
  stepItems: string[],
  tags: { deprecated?: boolean; since?: string },
): DocstringExtraction {
  return {
    title: title.trim(),
    purpose: purposeLines.join(' ').replace(/\s+/g, ' ').trim(),
    steps: stepItems.map((content, i) => ({ order: i + 1, content: content.trim() })),
    tags,
  };
}

function parseTagLine(line: string): { tag: string; body: string } | null {
  const m = line.match(/^\s*@(\w+)\s*(.*)$/);
  if (!m) return null;
  return { tag: m[1].toLowerCase(), body: m[2] };
}

function extractJsDoc(sourceLines: string[], method: MethodInfo): ExtractResult | null {
  let idx = method.start_line - 2;
  while (idx >= 0 && sourceLines[idx].trim() === '') idx--;
  if (idx < 0) return null;

  const endLine = idx;
  if (!sourceLines[endLine].trimEnd().endsWith('*/')) return null;

  let startLine = endLine;
  while (startLine >= 0 && !sourceLines[startLine].trimStart().startsWith('/**')) {
    startLine--;
  }
  if (startLine < 0) return null;

  if (method.start_line - (endLine + 1) > ATTACHMENT_MAX_GAP) {
    return ambiguity('unattached', `JSDoc ends ${method.start_line - (endLine + 1)} lines before method`, startLine + 1, endLine + 1);
  }

  const rawLines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    let line = sourceLines[i];
    line = line.replace(/^\s*\/\*\*\s?/, '');
    line = line.replace(/\s*\*\/\s*$/, '');
    line = line.replace(/^\s*\*\s?/, '');
    rawLines.push(line);
  }

  const tags: { deprecated?: boolean; since?: string } = {};
  const steps: string[] = [];
  const purposeLines: string[] = [];
  let title = '';
  let currentTag: { tag: string; body: string } | null = null;
  const flushTag = () => {
    if (!currentTag) return;
    if (currentTag.tag === 'deprecated') tags.deprecated = true;
    else if (currentTag.tag === 'since') tags.since = currentTag.body.trim();
    else if (currentTag.tag === 'param') steps.push(`param ${currentTag.body}`);
    else if (currentTag.tag === 'returns' || currentTag.tag === 'return') steps.push(`returns: ${currentTag.body}`);
    else if (currentTag.tag === 'throws' || currentTag.tag === 'throw') steps.push(`throws: ${currentTag.body}`);
    currentTag = null;
  };

  for (const line of rawLines) {
    const parsed = parseTagLine(line);
    if (parsed) {
      flushTag();
      currentTag = parsed;
    } else if (currentTag) {
      if (line.trim().length > 0) currentTag.body += ' ' + line.trim();
    } else if (title === '') {
      if (line.trim().length > 0) title = line.trim();
    } else {
      if (line.trim().length > 0) purposeLines.push(line.trim());
    }
  }
  flushTag();

  if (steps.length === 0) {
    const enumeratedIdxs: number[] = [];
    for (let i = 0; i < purposeLines.length; i++) {
      if (/^(\d+\.|[-*])\s+/.test(purposeLines[i])) enumeratedIdxs.push(i);
    }
    if (enumeratedIdxs.length >= 2) {
      for (const i of enumeratedIdxs) {
        steps.push(purposeLines[i].replace(/^(\d+\.|[-*])\s+/, ''));
      }
      for (let j = enumeratedIdxs.length - 1; j >= 0; j--) {
        purposeLines.splice(enumeratedIdxs[j], 1);
      }
    }
  }

  return makeExtraction(title, purposeLines, steps, tags);
}

function extractPyDoc(sourceLines: string[], method: MethodInfo): ExtractResult | null {
  let bodyStart = method.start_line;
  while (bodyStart <= method.end_line && bodyStart < sourceLines.length) {
    const line = sourceLines[bodyStart].trim();
    if (line.length > 0 && !line.endsWith(':')) {
      bodyStart++;
      continue;
    }
    bodyStart++;
    break;
  }

  let docStart = bodyStart;
  while (docStart < sourceLines.length && sourceLines[docStart].trim() === '') docStart++;
  if (docStart >= sourceLines.length) return null;

  const firstLine = sourceLines[docStart].trim();
  const quoteMatch = firstLine.match(/^([rRbBuU]*)("""|''')/);
  if (!quoteMatch) return null;

  if (docStart - bodyStart > ATTACHMENT_MAX_GAP) {
    return ambiguity('unattached', 'Python docstring too far from def', docStart + 1, docStart + 1);
  }

  const quote = quoteMatch[2];
  const afterOpen = firstLine.slice(quoteMatch[0].length);
  const docLines: string[] = [];
  if (afterOpen.includes(quote)) {
    docLines.push(afterOpen.slice(0, afterOpen.indexOf(quote)));
  } else {
    if (afterOpen.length > 0) docLines.push(afterOpen);
    let i = docStart + 1;
    while (i < sourceLines.length && !sourceLines[i].includes(quote)) {
      docLines.push(sourceLines[i]);
      i++;
    }
    if (i < sourceLines.length) {
      const closing = sourceLines[i];
      const before = closing.slice(0, closing.indexOf(quote));
      if (before.length > 0) docLines.push(before);
    }
  }

  const minIndent = docLines
    .filter((l) => l.trim().length > 0)
    .reduce((m, l) => Math.min(m, l.match(/^ */)?.[0].length ?? 0), Infinity);
  const dedented = docLines.map((l) => (minIndent === Infinity ? l : l.slice(minIndent)));

  const title = dedented[0]?.trim() ?? '';
  const rest = dedented.slice(1);

  const tags: { deprecated?: boolean; since?: string } = {};
  const steps: string[] = [];
  const purposeLines: string[] = [];

  let section: 'none' | 'args' | 'returns' | 'raises' = 'none';
  for (let i = 0; i < rest.length; i++) {
    const line = rest[i];
    const trimmed = line.trim();

    const headerGoogle = trimmed.match(/^(Args|Arguments|Returns|Yields|Raises|Examples):\s*$/);
    const headerNumPy = i + 1 < rest.length && /^-+$/.test(rest[i + 1].trim()) && /^(Parameters|Returns|Raises|Yields|Examples)$/.test(trimmed);

    if (headerGoogle) {
      section = headerGoogle[1].startsWith('Arg') ? 'args' : headerGoogle[1].startsWith('Return') || headerGoogle[1].startsWith('Yield') ? 'returns' : headerGoogle[1].startsWith('Raise') ? 'raises' : 'none';
      continue;
    }
    if (headerNumPy) {
      section = trimmed.startsWith('Param') ? 'args' : trimmed.startsWith('Return') || trimmed.startsWith('Yield') ? 'returns' : trimmed.startsWith('Raise') ? 'raises' : 'none';
      i++;
      continue;
    }

    if (/\.\.\s*deprecated::/.test(trimmed) || /\bDEPRECATED\b/.test(trimmed)) {
      tags.deprecated = true;
      continue;
    }
    const versionMatch = trimmed.match(/\.\.\s*versionadded::\s*(\S+)/);
    if (versionMatch) {
      tags.since = versionMatch[1];
      continue;
    }

    if (section === 'args') {
      const m = trimmed.match(/^(\w+)\s*(?:\(([^)]*)\))?:\s*(.*)$/);
      if (m) steps.push(`param ${m[1]}: ${m[3]}`);
    } else if (section === 'returns') {
      if (trimmed.length > 0) steps.push(`returns: ${trimmed}`);
    } else if (section === 'raises') {
      const m = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
      if (m) steps.push(`throws ${m[1]}: ${m[2]}`);
    } else {
      if (trimmed.length > 0) purposeLines.push(trimmed);
    }
  }

  return makeExtraction(title, purposeLines, steps, tags);
}

function extractCsDoc(sourceLines: string[], method: MethodInfo): ExtractResult | null {
  let idx = method.start_line - 2;
  while (idx >= 0 && sourceLines[idx].trim() === '') idx--;
  if (idx < 0 || !sourceLines[idx].trimStart().startsWith('///')) return null;

  const endLine = idx;
  let startLine = endLine;
  while (startLine - 1 >= 0 && sourceLines[startLine - 1].trimStart().startsWith('///')) startLine--;

  if (method.start_line - (endLine + 1) > ATTACHMENT_MAX_GAP) {
    return ambiguity('unattached', 'C# XML doc too far from method', startLine + 1, endLine + 1);
  }

  const blob = sourceLines.slice(startLine, endLine + 1)
    .map((l) => l.replace(/^\s*\/\/\/\s?/, ''))
    .join('\n');

  const tags: { deprecated?: boolean; since?: string } = {};
  const steps: string[] = [];

  const summaryMatch = blob.match(/<summary>([\s\S]*?)<\/summary>/);
  const summaryText = summaryMatch ? summaryMatch[1].trim() : '';
  const summaryLines = summaryText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const title = summaryLines[0] ?? '';
  const purposeLines = summaryLines.slice(1);

  const remarksMatch = blob.match(/<remarks>([\s\S]*?)<\/remarks>/);
  if (remarksMatch) {
    for (const line of remarksMatch[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      purposeLines.push(line);
    }
  }

  for (const m of blob.matchAll(/<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g)) {
    steps.push(`param ${m[1]}: ${m[2].trim()}`);
  }
  for (const m of blob.matchAll(/<returns>([\s\S]*?)<\/returns>/g)) {
    steps.push(`returns: ${m[1].trim()}`);
  }
  for (const m of blob.matchAll(/<exception\s+cref="([^"]+)">([\s\S]*?)<\/exception>/g)) {
    steps.push(`throws ${m[1]}: ${m[2].trim()}`);
  }

  if (/<obsolete\s*\/?>/.test(blob) || /\[Obsolete\]/.test(blob)) tags.deprecated = true;
  const sinceMatch = blob.match(/<since>([\s\S]*?)<\/since>/);
  if (sinceMatch) tags.since = sinceMatch[1].trim();

  return makeExtraction(title, purposeLines, steps, tags);
}

function extractDoxygen(sourceLines: string[], method: MethodInfo): ExtractResult | null {
  const jsdocResult = extractJsDoc(sourceLines, method);
  if (jsdocResult && 'title' in jsdocResult) {
    return jsdocResult;
  }

  let idx = method.start_line - 2;
  while (idx >= 0 && sourceLines[idx].trim() === '') idx--;
  if (idx < 0) return null;

  const trimmedEnd = sourceLines[idx].trimStart();
  if (!trimmedEnd.startsWith('//!') && !trimmedEnd.startsWith('///')) return null;
  const endLine = idx;
  let startLine = endLine;
  while (startLine - 1 >= 0) {
    const t = sourceLines[startLine - 1].trimStart();
    if (!t.startsWith('//!') && !t.startsWith('///')) break;
    startLine--;
  }
  if (method.start_line - (endLine + 1) > ATTACHMENT_MAX_GAP) {
    return ambiguity('unattached', 'Doxygen doc too far from method', startLine + 1, endLine + 1);
  }

  const rawLines = sourceLines.slice(startLine, endLine + 1).map((l) =>
    l.replace(/^\s*\/\/[!/]\s?/, ''),
  );

  const tags: { deprecated?: boolean; since?: string } = {};
  const steps: string[] = [];
  const purposeLines: string[] = [];
  let title = '';

  for (const line of rawLines) {
    const tagMatch = line.match(/^\s*[@\\](\w+)\s*(.*)$/);
    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase();
      const body = tagMatch[2];
      if (tag === 'brief') {
        title = body.trim();
      } else if (tag === 'param') {
        steps.push(`param ${body}`);
      } else if (tag === 'return' || tag === 'returns') {
        steps.push(`returns: ${body}`);
      } else if (tag === 'throw' || tag === 'throws') {
        steps.push(`throws: ${body}`);
      } else if (tag === 'deprecated') {
        tags.deprecated = true;
      } else if (tag === 'since') {
        tags.since = body.trim();
      }
    } else if (line.trim().length > 0) {
      if (title === '') title = line.trim();
      else purposeLines.push(line.trim());
    }
  }

  return makeExtraction(title, purposeLines, steps, tags);
}

export function extractDocstrings(
  language: 'ts' | 'js' | 'py' | 'cs' | 'cpp',
  source: string,
  methods: Array<{ name: string; start_line: number; end_line: number }>,
): Map<string, DocstringExtraction | DocstringAmbiguity> {
  const sourceLines = source.split(/\r?\n/);
  const out = new Map<string, DocstringExtraction | DocstringAmbiguity>();

  const extractor = language === 'py' ? extractPyDoc
    : language === 'cs' ? extractCsDoc
    : language === 'cpp' ? extractDoxygen
    : extractJsDoc;

  for (const method of methods) {
    const result = extractor(sourceLines, method);
    if (result !== null) {
      if (out.has(method.name)) {
        out.set(method.name, ambiguity('multiple_candidates', `Multiple methods named ${method.name}`, method.start_line, method.end_line));
      } else {
        out.set(method.name, result);
      }
    }
  }

  return out;
}
