/**
 * Pure selector functions for the sidebar artifact tree.
 * No React, no Zustand — safe to unit test in isolation.
 */

export interface TreeSection {
  id: string;
  leaves: { id: string; name: string }[];
}

/** Filter items with pinned === true. */
export function selectPinnedNodes<T extends { pinned?: boolean }>(items: T[]): T[] {
  return items.filter((item) => item.pinned === true);
}

/** Blueprint documents, excluding deprecated and vibeinstructions, sorted by lastModified desc. */
export function selectBlueprintNodes<
  T extends { id: string; blueprint?: boolean; deprecated?: boolean; name: string; lastModified: number }
>(documents: T[]): Array<T & { type: 'document' }> {
  return documents
    .filter((d) => d.blueprint === true && !d.name.endsWith('vibeinstructions'))
    .slice()
    .sort((a, b) => b.lastModified - a.lastModified)
    .map((d) => ({ ...d, type: 'document' as const }));
}

/** Linked snippets — type:'code' artifacts. Sorted by lastModified desc. */
export function selectLinkedSnippets<
  T extends {
    name: string;
    content?: string;
    lastModified: number;
    linked?: boolean;
    filePath?: string;
    dirty?: boolean;
  }
>(snippets: T[]): Array<T & { type: 'snippet'; _filePath: string; _dirty: boolean }> {
  return snippets
    .filter((snip) => (snip as any).type === 'code')
    .slice()
    .sort((a, b) => b.lastModified - a.lastModified)
    .map((snip) => {
      const filePath = (snip as any).filePath || snip.name;
      const displayName = filePath ? filePath.split('/').pop() || snip.name : snip.name;
      const dirty = !!(snip as any).dirty;
      return {
        ...snip,
        name: displayName,
        type: 'snippet' as const,
        _filePath: filePath,
        _dirty: dirty,
      };
    });
}

/** Catch-all diagrams — type-tag only. */
export function selectCatchAllDiagrams<T extends object>(
  diagrams: T[]
): Array<T & { type: 'diagram' }> {
  return diagrams.map((d) => ({ ...d, type: 'diagram' as const }));
}

/** Catch-all documents — exclude vibeinstructions, blueprints, and task-graph. */
export function selectCatchAllDocuments<
  T extends { name: string; blueprint?: boolean }
>(documents: T[]): Array<T & { type: 'document' }> {
  return documents
    .filter(
      (d) =>
        !d.name.endsWith('vibeinstructions') &&
        d.blueprint !== true &&
        d.name !== 'task-graph'
    )
    .map((d) => ({ ...d, type: 'document' as const }));
}

/** Catch-all designs — supply content/lastModified defaults. */
export function selectCatchAllDesigns<
  T extends { content?: string; lastModified?: number }
>(designs: T[]): Array<T & { content: string; lastModified: number; type: 'design' }> {
  return designs.map((d) => ({
    ...d,
    content: d.content ?? '',
    lastModified: d.lastModified ?? Date.now(),
    type: 'design' as const,
  }));
}

/** Catch-all spreadsheets — supply content/lastModified defaults. */
export function selectCatchAllSpreadsheets<
  T extends { content?: string; lastModified?: number }
>(
  spreadsheets: T[]
): Array<T & { content: string; lastModified: number; type: 'spreadsheet' }> {
  return spreadsheets.map((s) => ({
    ...s,
    content: s.content ?? '',
    lastModified: s.lastModified ?? Date.now(),
    type: 'spreadsheet' as const,
  }));
}

/**
 * Catch-all snippets — exclude vibeinstructions and code-type artifacts,
 * dedupe by parsed.groupId, map to displayName = parsed.groupName || snip.name.
 */
export function selectCatchAllSnippets<
  T extends {
    name: string;
    content?: string;
    lastModified: number;
    linked?: boolean;
  }
>(snippets: T[]): Array<T & { type: 'snippet' }> {
  const seenGroups = new Set<string>();
  return snippets
    .slice()
    .sort((a, b) => b.lastModified - a.lastModified)
    .filter((snip) => {
      if (snip.name.endsWith('vibeinstructions')) return false;
      // Exclude code-type artifacts (they appear in the linked-files section)
      if ((snip as any).type === 'code') return false;
      try {
        const parsed = JSON.parse(snip.content || '');
        if (parsed.groupId) {
          if (seenGroups.has(parsed.groupId)) return false;
          seenGroups.add(parsed.groupId);
        }
      } catch {
        /* not JSON, keep it */
      }
      return true;
    })
    .map((snip) => {
      let displayName = snip.name;
      try {
        const parsed = JSON.parse(snip.content || '');
        if (parsed.groupName) displayName = parsed.groupName;
      } catch {
        /* keep original name */
      }
      return {
        ...snip,
        name: displayName,
        type: 'snippet' as const,
      };
    });
}

/**
 * Filter a tree by search query. Empty query => all leaves and sections visible.
 * Otherwise, case-insensitive substring match on leaf.name; a section is
 * "matched" if it contains at least one matching leaf.
 */
export function filterTreeBySearch(
  sections: TreeSection[],
  query: string
): { visibleNodes: Set<string>; sectionsWithMatches: Set<string> } {
  const trimmed = query.trim();
  const visibleNodes = new Set<string>();
  const sectionsWithMatches = new Set<string>();

  if (trimmed === '') {
    for (const section of sections) {
      sectionsWithMatches.add(section.id);
      for (const leaf of section.leaves) {
        visibleNodes.add(leaf.id);
      }
    }
    return { visibleNodes, sectionsWithMatches };
  }

  const needle = trimmed.toLowerCase();
  for (const section of sections) {
    let sectionHasMatch = false;
    for (const leaf of section.leaves) {
      if (leaf.name.toLowerCase().includes(needle)) {
        visibleNodes.add(leaf.id);
        sectionHasMatch = true;
      }
    }
    if (sectionHasMatch) {
      sectionsWithMatches.add(section.id);
    }
  }

  return { visibleNodes, sectionsWithMatches };
}
