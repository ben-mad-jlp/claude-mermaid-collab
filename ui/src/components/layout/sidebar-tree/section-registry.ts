import type { TreeNode } from './getActionsForNode';

export type SectionRenderer = 'flat' | 'folder-tree' | 'custom';

export type SectionDef = {
  id: string;
  label: string;
  renderer: SectionRenderer;
  multiselectable: boolean;
  collapsible: boolean;
  filter: (node: TreeNode) => boolean;
  transform?: (name: string) => string;
};

export const SECTION_DEFS: SectionDef[] = [
  {
    id: 'implementing',
    label: 'Implementing',
    renderer: 'custom',
    multiselectable: false,
    collapsible: true,
    filter: (n) =>
      n.name.startsWith('Implementing/') ||
      n.kind === 'task-graph' ||
      n.kind === 'task-details' ||
      n.kind === 'blueprint',
    transform: (name) => name.replace(/^Implementing\//, ''),
  },
  {
    id: 'documents',
    label: 'Documents',
    renderer: 'folder-tree',
    multiselectable: true,
    collapsible: true,
    filter: (n) =>
      n.kind === 'artifact' &&
      n.artifactType === 'document' &&
      !n.name.startsWith('Implementing/'),
  },
  {
    id: 'diagrams',
    label: 'Diagrams',
    renderer: 'folder-tree',
    multiselectable: true,
    collapsible: true,
    filter: (n) =>
      n.kind === 'artifact' &&
      n.artifactType === 'diagram' &&
      !n.name.startsWith('Implementing/'),
  },
  {
    id: 'designs',
    label: 'Designs',
    renderer: 'folder-tree',
    multiselectable: true,
    collapsible: true,
    filter: (n) => n.kind === 'artifact' && n.artifactType === 'design',
  },
  {
    id: 'snippets',
    label: 'Snippets',
    renderer: 'folder-tree',
    multiselectable: true,
    collapsible: true,
    filter: (n) => n.kind === 'artifact' && n.artifactType === 'snippet',
  },
  {
    id: 'spreadsheets',
    label: 'Spreadsheets',
    renderer: 'flat',
    multiselectable: true,
    collapsible: true,
    filter: (n) => n.kind === 'artifact' && n.artifactType === 'spreadsheet',
  },
  {
    // "Media" aggregates images, video (an image-type artifact with a video/* MIME),
    // and audio under one section (rendered by ImagesSection with title="Media").
    id: 'images',
    label: 'Media',
    renderer: 'flat',
    multiselectable: true,
    collapsible: true,
    filter: (n) => n.kind === 'artifact' && (n.artifactType === 'image' || n.artifactType === 'audio'),
  },
  {
    id: 'embeds',
    label: 'Embeds',
    renderer: 'flat',
    multiselectable: false,
    collapsible: true,
    filter: (n) => n.kind === 'embed',
  },
  {
    id: 'pins',
    label: 'Pinned',
    renderer: 'flat',
    multiselectable: false,
    collapsible: true,
    filter: (n) => !!n.pinned,
  },
  {
    id: 'recent',
    label: 'Recently Updated',
    renderer: 'flat',
    multiselectable: false,
    collapsible: true,
    // Intentional: recent nodes are built externally by ArtifactTree's time-window useMemo
    // (recentlyUpdatedNodes) and passed directly to RecentSection — this filter is never
    // called by the section registry itself.
    filter: () => false,
  },
  {
    id: 'archived',
    label: 'Archived Blueprints',
    renderer: 'flat',
    multiselectable: false,
    collapsible: true,
    filter: (n) => n.kind === 'blueprint' && !!n.deprecated,
  },
];

export const ALL_SECTION_IDS = SECTION_DEFS.map((s) => s.id);

export const MULTISELECT_EXCLUDED_SECTIONS = new Set([
  'pins',
  'recent',
  'implementing',
]);
