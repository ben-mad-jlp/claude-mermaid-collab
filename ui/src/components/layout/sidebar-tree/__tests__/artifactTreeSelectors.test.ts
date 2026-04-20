import { describe, it, expect } from 'vitest';
import {
  selectPinnedNodes,
  selectBlueprintNodes,
  selectLinkedSnippets,
  selectCatchAllDocuments,
  selectCatchAllSnippets,
  selectCatchAllDesigns,
  selectCatchAllSpreadsheets,
  filterTreeBySearch,
  TreeSection,
} from '../artifactTreeSelectors';

// ---------- Fixtures ----------

const doc = (over: Partial<any> = {}): any => ({
  id: over.id ?? 'd1',
  name: over.name ?? 'doc',
  artifactKind: 'document',
  content: over.content ?? 'body',
  lastModified: over.lastModified ?? 1000,
  metadata: {},
  ...over,
});

const snip = (over: Partial<any> = {}): any => ({
  id: over.id ?? 's1',
  name: over.name ?? 'snip',
  artifactKind: 'snippet',
  content: over.content ?? '',
  lastModified: over.lastModified ?? 1000,
  metadata: {},
  ...over,
});

const design = (over: Partial<any> = {}): any => ({
  id: over.id ?? 'de1',
  name: over.name ?? 'design',
  artifactKind: 'design',
  lastModified: over.lastModified ?? 1000,
  metadata: {},
  ...over,
});

const sheet = (over: Partial<any> = {}): any => ({
  id: over.id ?? 'sp1',
  name: over.name ?? 'sheet',
  artifactKind: 'spreadsheet',
  lastModified: over.lastModified ?? 1000,
  metadata: {},
  ...over,
});

// ---------- selectPinnedNodes ----------

describe('selectPinnedNodes', () => {
  it('returns only pinned artifacts and preserves order', () => {
    const a = doc({ id: 'a', metadata: { pinned: true } });
    const b = doc({ id: 'b' });
    const c = doc({ id: 'c', metadata: { pinned: true } });
    const result = selectPinnedNodes([a, b, c]);
    expect(result.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('returns [] on empty input', () => {
    expect(selectPinnedNodes([])).toEqual([]);
  });
});

// ---------- selectBlueprintNodes ----------

describe('selectBlueprintNodes', () => {
  it('excludes deprecated, vibeinstructions suffix, non-blueprint; sorts desc; adds type=document', () => {
    const items: any[] = [
      doc({ id: 'bp1', name: 'blueprint', metadata: { blueprint: true }, lastModified: 10 }),
      doc({ id: 'bp2', name: 'feature.blueprint', metadata: { blueprint: true }, lastModified: 30 }),
      doc({ id: 'bp3', name: 'old.blueprint', metadata: { blueprint: true, deprecated: true }, lastModified: 50 }),
      doc({ id: 'vi', name: 'foo.vibeinstructions', metadata: { blueprint: true }, lastModified: 40 }),
      doc({ id: 'plain', name: 'notes', lastModified: 100 }),
      doc({ id: 'bp4', name: 'another.blueprint', metadata: { blueprint: true }, lastModified: 20 }),
    ];
    const out = selectBlueprintNodes(items);
    expect(out.map((n) => n.id)).toEqual(['bp2', 'bp4', 'bp1']);
    expect(out.every((n) => n.type === 'document')).toBe(true);
  });
});

// ---------- selectLinkedSnippets ----------

describe('selectLinkedSnippets', () => {
  it('includes metadata.linked, parsed linked, skips bad JSON, derives displayName, propagates flags, sorts desc', () => {
    const items: any[] = [
      snip({
        id: 'meta',
        name: 'raw-meta',
        metadata: { linked: true, _filePath: '/a/b/meta.ts', _dirty: true },
        lastModified: 100,
      }),
      snip({
        id: 'parsed',
        name: 'raw-parsed',
        content: JSON.stringify({ linked: true, filePath: '/x/y/parsed-file.ts' }),
        lastModified: 200,
      }),
      snip({
        id: 'bad',
        name: 'bad-json',
        content: '{not json',
        lastModified: 300,
      }),
      snip({ id: 'plain', name: 'plain', lastModified: 50 }),
    ];
    const out = selectLinkedSnippets(items);
    expect(out.map((n: any) => n.id)).toEqual(['parsed', 'meta']);
    const parsed = out.find((n: any) => n.id === 'parsed') as any;
    expect(parsed.name).toBe('parsed-file.ts');
    const meta = out.find((n: any) => n.id === 'meta') as any;
    expect(meta._filePath).toBe('/a/b/meta.ts');
    expect(meta._dirty).toBe(true);
  });
});

// ---------- selectCatchAllDocuments ----------

describe('selectCatchAllDocuments', () => {
  it('excludes vibeinstructions, blueprint, task-graph', () => {
    const items: any[] = [
      doc({ id: 'keep', name: 'notes' }),
      doc({ id: 'vi', name: 'foo.vibeinstructions' }),
      doc({ id: 'bp', name: 'x.blueprint', metadata: { blueprint: true } }),
      doc({ id: 'tg', name: 'task-graph' }),
    ];
    const out = selectCatchAllDocuments(items);
    expect(out.map((n: any) => n.id)).toEqual(['keep']);
  });
});

// ---------- selectCatchAllSnippets ----------

describe('selectCatchAllSnippets', () => {
  it('excludes vibeinstructions, linked (meta+parsed), dedupes by groupId, uses groupName, tolerates non-JSON', () => {
    const items: any[] = [
      snip({ id: 's-plain', name: 'plain', content: 'not json' }),
      snip({ id: 's-vi', name: 'x.vibeinstructions' }),
      snip({ id: 's-linked-meta', name: 'lm', metadata: { linked: true } }),
      snip({
        id: 's-linked-parsed',
        name: 'lp',
        content: JSON.stringify({ linked: true, filePath: '/a/b.ts' }),
      }),
      snip({
        id: 's-grp-1',
        name: 'grp-one',
        metadata: { groupId: 'g1', groupName: 'Group One' },
      }),
      snip({
        id: 's-grp-2',
        name: 'grp-two',
        metadata: { groupId: 'g1', groupName: 'Group One' },
      }),
    ];
    const out = selectCatchAllSnippets(items);
    const ids = out.map((n: any) => n.id);
    expect(ids).toContain('s-plain');
    expect(ids).not.toContain('s-vi');
    expect(ids).not.toContain('s-linked-meta');
    expect(ids).not.toContain('s-linked-parsed');
    const groupNodes = out.filter((n: any) => n.name === 'Group One');
    expect(groupNodes.length).toBe(1);
  });
});

// ---------- selectCatchAllDesigns / Spreadsheets defaults ----------

describe('selectCatchAllDesigns / selectCatchAllSpreadsheets', () => {
  it('defaults content to empty string and lastModified to a number', () => {
    const designs: any[] = [{ id: 'd', name: 'design', artifactKind: 'design' }];
    const sheets: any[] = [{ id: 'sp', name: 'sheet', artifactKind: 'spreadsheet' }];
    const outD = selectCatchAllDesigns(designs);
    const outS = selectCatchAllSpreadsheets(sheets);
    expect(typeof outD[0].lastModified).toBe('number');
    expect(outD[0].content).toBe('');
    expect(typeof outS[0].lastModified).toBe('number');
    expect(outS[0].content).toBe('');
  });
});

// ---------- filterTreeBySearch ----------

const makeSections = (): TreeSection[] => [
  {
    id: 'sec1',
    label: 'Section 1',
    nodes: [
      { id: 'n1', name: 'Alpha' } as any,
      { id: 'n2', name: 'Beta' } as any,
    ],
  } as any,
  {
    id: 'sec2',
    label: 'Section 2',
    nodes: [{ id: 'n3', name: 'Gamma' } as any],
  } as any,
];

describe('filterTreeBySearch', () => {
  it('empty query returns all-visible Sets for leaves and sections', () => {
    const sections = makeSections();
    const { visibleNodes, sectionsWithMatches } = filterTreeBySearch(sections, '');
    expect(visibleNodes.has('n1')).toBe(true);
    expect(visibleNodes.has('n2')).toBe(true);
    expect(visibleNodes.has('n3')).toBe(true);
    expect(sectionsWithMatches.has('sec1')).toBe(true);
    expect(sectionsWithMatches.has('sec2')).toBe(true);
  });

  it('non-empty query does case-insensitive substring match on name', () => {
    const sections = makeSections();
    const { visibleNodes, sectionsWithMatches } = filterTreeBySearch(sections, 'alp');
    expect(visibleNodes.has('n1')).toBe(true);
    expect(visibleNodes.has('n2')).toBe(false);
    expect(visibleNodes.has('n3')).toBe(false);
    expect(sectionsWithMatches.has('sec1')).toBe(true);
    expect(sectionsWithMatches.has('sec2')).toBe(false);
  });

  it('query matching nothing returns two empty Sets', () => {
    const sections = makeSections();
    const { visibleNodes, sectionsWithMatches } = filterTreeBySearch(sections, 'zzzzz');
    expect(visibleNodes.size).toBe(0);
    expect(sectionsWithMatches.size).toBe(0);
  });
});
