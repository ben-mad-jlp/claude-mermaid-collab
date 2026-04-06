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
}

export interface ParsedPseudoFile {
  title: string;
  purpose: string;
  syncedAt: string | null;
  moduleContext: string;
  methods: ParsedMethod[];
}

export function parsePseudo(content: string): ParsedPseudoFile {
  if (content.trim() === '') {
    return {
      title: '',
      purpose: '',
      syncedAt: null,
      moduleContext: '',
      methods: [],
    };
  }

  const lines = content.split('\n');

  let title = '';
  let purpose = '';
  let syncedAt: string | null = null;
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
    if (line.match(/^FUNCTION\s+/)) {
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
    const match = line.match(
      /^FUNCTION\s+(\w[\w.]*)\s*(\([^)]*\))?\s*(?:->\s*(.+?))?\s*(?:(EXPORT)\s*(?:\[(\d{4}-\d{2}-\d{2})\])?|(?:\[(\d{4}-\d{2}-\d{2})\])\s*(EXPORT))?$/
    );

    if (match) {
      const name = match[1];
      const paramsWithParens = match[2] || '';
      const params = paramsWithParens.slice(1, -1).trim();
      const returnType = match[3] ? match[3].trim() : '';
      const isExport = !!match[4] || !!match[7];
      const date = match[5] || match[6] || null;

      // Collect body lines until --- separator or next FUNCTION
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== '---') {
        body.push(lines[i]);
        i++;
      }

      const calls = parseCallsFromBody(body);
      const steps = parseStepsFromBody(body);

      methods.push({
        name,
        params,
        returnType,
        isExport,
        date,
        calls,
        steps,
        sortOrder: sortOrder++,
      });

      // Skip the --- separator
      if (i < lines.length && lines[i] === '---') {
        i++;
      }
    } else {
      i++;
    }
  }

  return {
    title,
    purpose,
    syncedAt,
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
