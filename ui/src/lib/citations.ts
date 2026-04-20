export type ToolCallRef = { id: string; name: string };

export type CitationSegment =
  | { kind: 'text'; value: string }
  | {
      kind: 'citation';
      value: string;
      toolUseId?: string;
      toolName?: string;
      index?: number;
    };

export function parseCitations(
  text: string,
  toolCalls: ReadonlyArray<ToolCallRef>,
): CitationSegment[] {
  if (!text) return [];

  const segments: CitationSegment[] = [];
  const regex = /\[\[([A-Za-z_][A-Za-z0-9_]*)#(\d+)\]\]/g;
  let lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const matchIndex = match.index ?? 0;
    const fullMatch = match[0];
    const kindRaw = match[1];
    const nStr = match[2];
    const n = parseInt(nStr, 10);

    if (matchIndex > lastIndex) {
      const preceding = text.slice(lastIndex, matchIndex);
      if (preceding.length > 0) {
        segments.push({ kind: 'text', value: preceding });
      }
    }

    const kind = kindRaw.toLowerCase();
    const matching = toolCalls.filter((tc) => tc.name.toLowerCase() === kind);
    const picked = matching[n - 1];

    if (picked) {
      segments.push({
        kind: 'citation',
        value: fullMatch,
        toolUseId: picked.id,
        toolName: picked.name,
        index: n,
      });
    } else {
      segments.push({ kind: 'text', value: fullMatch });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    const trailing = text.slice(lastIndex);
    if (trailing.length > 0) {
      segments.push({ kind: 'text', value: trailing });
    }
  }

  return segments;
}
