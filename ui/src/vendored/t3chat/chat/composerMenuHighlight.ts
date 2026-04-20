export interface HighlightSegment {
  text: string;
  match: boolean;
}

export function highlightMatch(label: string, query: string): HighlightSegment[] {
  if (!query) return [{ text: label, match: false }];
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  const idx = l.indexOf(q);
  if (idx < 0) return [{ text: label, match: false }];
  const segments: HighlightSegment[] = [];
  if (idx > 0) segments.push({ text: label.slice(0, idx), match: false });
  segments.push({ text: label.slice(idx, idx + query.length), match: true });
  if (idx + query.length < label.length) {
    segments.push({ text: label.slice(idx + query.length), match: false });
  }
  return segments;
}
