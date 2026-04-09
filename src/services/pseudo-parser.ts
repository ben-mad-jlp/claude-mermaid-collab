export interface ParsedStep {
  content: string;
  depth: number;
  sortOrder: number;
}

export interface ParsedMethod {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  date: string | null;
  calls: Array<{ name: string; fileStem: string }>;
  steps: ParsedStep[];
  sortOrder: number;
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  paramCount: number;
  stepCount: number;
  owningSymbol: string | null;
  sourceLine: number | null;
  sourceLineEnd: number | null;
}

export interface ParsedPseudoFile {
  title: string;
  purpose: string;
  syncedAt: string | null;
  moduleContext: string;
  methods: ParsedMethod[];
  sourceFilePath: string | null;
  language: string | null;
}

export function parsePseudo(content: string): ParsedPseudoFile {
  if (content.trim() === '') {
    return {
      title: '',
      purpose: '',
      syncedAt: null,
      moduleContext: '',
      methods: [],
      sourceFilePath: null,
      language: null,
    };
  }

  const lines = content.split('\n');

  let title = '';
  let purpose = '';
  let syncedAt: string | null = null;
  let sourceFilePath: string | null = null;
  let language: string | null = null;
  let proseEndIndex = 0;

  // Parse header lines (// comments)
  let headerCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('//')) {
      const headerText = lines[i].slice(2).trim();
      if (headerCount === 0) {
        title = headerText;
      } else if (headerCount === 1) {
        purpose = headerText;
      } else {
        const syncedMatch = headerText.match(/^synced:\s*(\S+)$/);
        if (syncedMatch) syncedAt = syncedMatch[1];
        const sourceMatch = headerText.match(/^source:\s*(.+)$/);
        if (sourceMatch) sourceFilePath = sourceMatch[1].trim();
        const languageMatch = headerText.match(/^language:\s*(.+)$/);
        if (languageMatch) language = languageMatch[1].trim();
      }
      headerCount++;
      proseEndIndex = i + 1;
    } else {
      break;
    }
  }

  // Collect module context lines (between headers and first FUNCTION)
  const moduleProseLines: string[] = [];
  let firstFunctionIndex = -1;

  for (let i = proseEndIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('FUNCTION ')) {
      firstFunctionIndex = i;
      break;
    }
    moduleProseLines.push(line);
  }

  if (firstFunctionIndex === -1) {
    firstFunctionIndex = lines.length;
  }

  const moduleContext = moduleProseLines.join('\n');

  // Parse methods (functions)
  const methods: ParsedMethod[] = [];
  let i = firstFunctionIndex;
  let sortOrder = 0;

  while (i < lines.length) {
    const line = lines[i];
    const header = parseFunctionHeader(line);

    if (!header) {
      i++;
      continue;
    }

    const { name, params, returnType, isExport, date } = header;

    // Collect body lines until --- separator or next FUNCTION
    const body: string[] = [];
    i++;
    while (i < lines.length && lines[i] !== '---' && !parseFunctionHeader(lines[i])) {
      body.push(lines[i]);
      i++;
    }

    // Parse metadata markers from the body (only lines before the first step)
    const { visibility, isAsync, kind, bodyWithoutMetadata } = extractMethodMetadata(body);

    const calls = parseCallsFromBody(bodyWithoutMetadata);
    const steps = parseStepsFromBody(bodyWithoutMetadata);

    const paramCount = params.trim()
      ? params.split(',').map(p => p.trim()).filter(p => p).length
      : 0;

    methods.push({
      name,
      params,
      returnType,
      isExport,
      date,
      calls,
      steps,
      sortOrder: sortOrder++,
      visibility,
      isAsync,
      kind,
      paramCount,
      stepCount: steps.length,
      owningSymbol: name.includes('.') ? name.split('.')[0] : null,
      sourceLine: null,
      sourceLineEnd: null,
    });

    // Skip the --- separator
    if (i < lines.length && lines[i] === '---') {
      i++;
    }
  }

  return {
    title,
    purpose,
    syncedAt,
    sourceFilePath,
    language,
    moduleContext,
    methods,
  };
}

function parseCallsFromBody(body: string[]): Array<{ name: string; fileStem: string }> {
  const calls: Array<{ name: string; fileStem: string }> = [];
  const callRegex = /(\w[\w.]*)\s*\(([^)]+)\)/g;

  for (const line of body) {
    if (!line.trimStart().startsWith('CALLS:')) continue;
    let match;
    callRegex.lastIndex = 0;
    while ((match = callRegex.exec(line)) !== null) {
      const name = match[1];
      const fileStem = match[2].trim();
      calls.push({ name, fileStem });
    }
  }

  return calls;
}

function parseStepsFromBody(body: string[]): ParsedStep[] {
  const steps: ParsedStep[] = [];
  let stepOrder = 0;

  for (const line of body) {
    // Skip CALLS lines and blank lines
    if (line.trimStart().startsWith('CALLS:')) continue;
    if (line.trim() === '') continue;

    // Compute depth from leading whitespace (2 spaces = 1 depth)
    const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
    const depth = Math.floor(leadingSpaces / 2);

    steps.push({
      content: line.trim(),
      depth,
      sortOrder: stepOrder++,
    });
  }

  return steps;
}

/**
 * Line tokeniser replacing the old FUNCTION header regex. Handles nested
 * parens (callback types like `(cb: (x: T) => U)`) and generic type params.
 */
function parseFunctionHeader(line: string): {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  date: string | null;
} | null {
  if (!line.startsWith('FUNCTION ')) return null;

  let pos = 'FUNCTION '.length;
  const len = line.length;

  // Skip any extra whitespace after FUNCTION
  while (pos < len && line[pos] === ' ') pos++;

  // Read identifier (letters, digits, _, .)
  const nameStart = pos;
  while (pos < len && /[A-Za-z0-9_.]/.test(line[pos])) pos++;
  if (pos === nameStart) return null;
  const name = line.slice(nameStart, pos);

  // Optional params: (...)
  let params = '';
  if (pos < len && line[pos] === '(') {
    let depth = 1;
    pos++;
    const paramStart = pos;
    while (pos < len && depth > 0) {
      if (line[pos] === '(') depth++;
      else if (line[pos] === ')') depth--;
      if (depth > 0) pos++;
    }
    if (depth !== 0) return null; // unclosed
    params = line.slice(paramStart, pos).trim();
    pos++; // skip ')'
  }

  // Skip whitespace
  while (pos < len && line[pos] === ' ') pos++;

  // Optional return type: -> ...
  let returnType = '';
  if (pos < len - 1 && line[pos] === '-' && line[pos + 1] === '>') {
    pos += 2;
    // Read up to end-of-line; trailing EXPORT/[date] extracted below
    const rest = line.slice(pos);
    // Find the trailing EXPORT token or [YYYY-MM-DD]
    const trailingMatch = rest.match(/^(.*?)\s*(\bEXPORT\b.*)?$/);
    if (trailingMatch) {
      let body = trailingMatch[1];
      // Strip any trailing [YYYY-MM-DD] that wasn't captured via EXPORT
      body = body.replace(/\s*\[\d{4}-\d{2}-\d{2}\]\s*$/, '');
      returnType = body.trim();
    }
    pos = len; // we've consumed the rest
  }

  // Parse trailing EXPORT and [YYYY-MM-DD] from the full tail after the return type
  const tail = line.slice(nameStart); // easier to regex the whole thing
  const isExport = /\bEXPORT\b/.test(tail);
  const dateMatch = tail.match(/\[(\d{4}-\d{2}-\d{2})\]/);
  const date = dateMatch ? dateMatch[1] : null;

  return { name, params, returnType, isExport, date };
}

/**
 * Extract VISIBILITY/ASYNC/KIND metadata markers from a method body.
 * Returns the metadata plus a filtered body that has the metadata lines removed.
 * Only lines BEFORE the first step/CALLS/non-blank-content are treated as metadata.
 */
function extractMethodMetadata(body: string[]): {
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  bodyWithoutMetadata: string[];
} {
  let visibility: 'public' | 'private' | 'protected' | 'internal' | null = null;
  let isAsync = false;
  let kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null = null;

  const out: string[] = [];
  let firstStepSeen = false;

  for (const line of body) {
    if (firstStepSeen) {
      out.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      out.push(line);
      continue;
    }

    // CALLS lines are passed through to the body (the existing parseCallsFromBody handles them).
    if (trimmed.startsWith('CALLS:')) {
      out.push(line);
      continue;
    }

    const meta = line.match(/^\s*([A-Z][A-Z_]+):\s*(.*)$/);
    if (meta) {
      const key = meta[1];
      const value = meta[2].trim();
      if (key === 'VISIBILITY') {
        if (value === 'public' || value === 'private' || value === 'protected' || value === 'internal') {
          visibility = value;
        }
        continue; // do not include in output
      }
      if (key === 'ASYNC') {
        isAsync = value.toLowerCase() === 'true';
        continue;
      }
      if (key === 'KIND') {
        if (
          value === 'function' || value === 'method' || value === 'constructor' ||
          value === 'getter' || value === 'setter' || value === 'callback'
        ) {
          kind = value;
        }
        continue;
      }
      // Unknown uppercase marker — drop silently (forward compat)
      continue;
    }

    // First non-metadata, non-blank, non-CALLS line = first step
    firstStepSeen = true;
    out.push(line);
  }

  return { visibility, isAsync, kind, bodyWithoutMetadata: out };
}
