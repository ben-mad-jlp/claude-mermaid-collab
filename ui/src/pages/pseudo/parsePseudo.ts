export type CallsRef = {
  name: string;
  fileStem: string;
};

export type ParsedFunction = {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  updatedAt: string | null; // [YYYY-MM-DD] from end of FUNCTION line
  calls: CallsRef[];
  body: string[];
};

export type ParsedPseudo = {
  titleLine: string;
  subtitleLine: string;
  syncedAt: string | null; // from "// synced: <ISO>" header line
  moduleProse: string[];
  functions: ParsedFunction[];
};

export function parsePseudo(content: string): ParsedPseudo {
  // Handle empty content
  if (content.trim() === '') {
    return {
      titleLine: '',
      subtitleLine: '',
      syncedAt: null,
      moduleProse: [],
      functions: []
    };
  }

  const lines = content.split('\n');

  let titleLine = '';
  let subtitleLine = '';
  let syncedAt: string | null = null;
  let proseEndIndex = 0;

  // Parse header lines (// comments)
  let headerCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('//')) {
      const headerText = lines[i].slice(2).trim();
      if (headerCount === 0) {
        titleLine = headerText;
      } else if (headerCount === 1) {
        subtitleLine = headerText;
      } else {
        // Look for "synced: <ISO>" in any subsequent // line
        const syncedMatch = headerText.match(/^synced:\s*(\S+)$/);
        if (syncedMatch) syncedAt = syncedMatch[1];
      }
      headerCount++;
      proseEndIndex = i + 1;
    } else {
      break;
    }
  }

  // Collect module prose (non-// lines before first FUNCTION)
  const moduleProse: string[] = [];
  let firstFunctionIndex = -1;

  for (let i = proseEndIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^FUNCTION\s+/)) {
      firstFunctionIndex = i;
      break;
    }
    moduleProse.push(line);
  }

  // If no functions found, remaining lines are still prose
  if (firstFunctionIndex === -1) {
    firstFunctionIndex = lines.length;
  }

  // Parse functions
  const functions: ParsedFunction[] = [];
  let i = firstFunctionIndex;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(
      /^FUNCTION\s+(\w[\w.]*)\s*(\([^)]*\))?\s*(?:->\s*(.+?))?\s*(EXPORT)?\s*(?:\[(\d{4}-\d{2}-\d{2})\])?$/
    );

    if (match) {
      const name = match[1];
      const paramsWithParens = match[2] || '';
      const params = paramsWithParens.slice(1, -1).trim(); // Remove parentheses
      const returnType = match[3] ? match[3].trim() : '';
      const isExport = !!match[4];
      const updatedAt = match[5] || null;

      // Collect body lines until --- separator
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== '---') {
        body.push(lines[i]);
        i++;
      }

      // Parse CALLS from body
      const calls = parseCallsFromBody(body);

      functions.push({
        name,
        params,
        returnType,
        isExport,
        updatedAt,
        calls,
        body
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
    titleLine,
    subtitleLine,
    syncedAt,
    moduleProse,
    functions
  };
}

function parseCallsFromBody(body: string[]): CallsRef[] {
  const calls: CallsRef[] = [];
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
