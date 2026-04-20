export interface SlashCommand {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
}

export interface SlashSearchResult {
  command: SlashCommand;
  score: number;
}

function scoreMatch(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - (t.length - q.length);
  const idx = t.indexOf(q);
  if (idx >= 0) return 250 - idx;
  // subsequence
  let i = 0;
  let matched = 0;
  for (const ch of t) {
    if (ch === q[i]) {
      matched++;
      i++;
      if (i === q.length) break;
    }
  }
  return i === q.length ? 100 - (t.length - matched) : 0;
}

export function searchSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashSearchResult[] {
  const stripped = query.startsWith('/') ? query.slice(1) : query;
  const results: SlashSearchResult[] = [];
  for (const cmd of commands) {
    const names = [cmd.name, ...(cmd.aliases ?? [])];
    let best = 0;
    for (const n of names) {
      const s = scoreMatch(stripped, n);
      if (s > best) best = s;
    }
    if (best > 0) results.push({ command: cmd, score: best });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
