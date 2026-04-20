export interface SlashTriggerMatch {
  query: string;
  start: number;
  end: number;
}

export function detectSlashTrigger(
  text: string,
  caret: number
): SlashTriggerMatch | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)\/([A-Za-z0-9_-]*)$/.exec(before);
  if (!match) return null;
  const slashIndex = before.lastIndexOf('/');
  return { query: match[2], start: slashIndex, end: caret };
}
