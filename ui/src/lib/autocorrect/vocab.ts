export interface VocabSnapshot {
  sessionNames: string[];
  docNames: string[];
  todoTitles: string[];
  fileSegments: string[];
  slashCommands: string[];
  mcpToolNames: string[];
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export function buildProjectVocab(
  snapshot: VocabSnapshot,
): { protected: Set<string>; targets: Set<string> } {
  const protected_set = new Set<string>();
  const targets_set = new Set<string>();

  const sources = [
    snapshot.sessionNames,
    snapshot.docNames,
    snapshot.todoTitles,
    snapshot.fileSegments,
  ];

  for (const source of sources) {
    for (const item of source) {
      const tokens = tokenize(item);
      for (const token of tokens) {
        protected_set.add(token);
        if (token.length >= 5) {
          targets_set.add(token);
        }
      }
    }
  }

  // Add slash commands and MCP tool names verbatim to protected
  for (const cmd of snapshot.slashCommands) {
    protected_set.add(cmd);
  }

  for (const tool of snapshot.mcpToolNames) {
    protected_set.add(tool);
  }

  return {
    protected: protected_set,
    targets: targets_set,
  };
}
