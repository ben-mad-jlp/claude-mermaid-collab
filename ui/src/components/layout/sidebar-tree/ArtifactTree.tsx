/**
 * ArtifactTree — top-level sidebar tree component.
 *
 * Aggregates sessionStore artifact lists into sectioned trees with search,
 * show-deprecated toggle, drag-and-drop upload, and context-menu actions.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../stores/sidebarTreeStore';
import { PseudoTreeBody, getAllDirPaths } from './PseudoTreeBody';
import { fetchPseudoFiles, type PseudoFileSummary } from '../../../lib/pseudo-api';
import {
  filterTreeBySearch,
  selectBlueprintNodes,
  selectCatchAllDocuments,
  type TreeSection,
} from './artifactTreeSelectors';
import ArtifactTreeNode from './ArtifactTreeNode';
import SidebarNodeContextMenu from './SidebarNodeContextMenu';
import TodosTreeSection from './TodosTreeSection';
import { SectionBranchRow } from './TreeBranchRow';
import { orderVisibleNodes, type VisibleTreeNode } from './orderVisibleNodes';
import {
  getActionsForNode,
  type ArtifactType,
  type TreeNode,
} from './getActionsForNode';
import { runBatchAction, type BatchDeps } from './runBatchAction';
import { importArtifact } from '../../../lib/importArtifact';
import { downloadArtifact } from '../../../lib/downloadArtifact';
import { emailArtifact } from '../../../lib/emailArtifact';
import { api } from '../../../lib/api';
import { useTabsStore, useSessionTabs } from '../../../stores/tabsStore';
import { ConfirmDialog } from '../../dialogs/ConfirmDialog';
import type { Item, ItemType } from '../../../types/item';

function toTabDescriptor(node: TreeNode) {
  if (node.kind === 'artifact' && node.artifactType) {
    return {
      id: node.id,
      kind: 'artifact' as const,
      artifactType: node.artifactType,
      artifactId: node.id,
      name: node.name,
    };
  }
  if (node.kind === 'embed') {
    return {
      id: node.id,
      kind: 'embed' as const,
      artifactId: node.id,
      name: node.name,
    };
  }
  if (node.kind === 'blueprint') {
    return {
      id: node.id,
      kind: 'blueprint' as const,
      artifactId: node.id,
      name: node.name,
    };
  }
  if (node.kind === 'task-graph') {
    return { id: node.id, kind: 'task-graph' as const, artifactId: node.id, name: node.name ?? 'Task Graph' };
  }
  if (node.kind === 'task-details') {
    return { id: node.id, kind: 'task-details' as const, artifactId: node.id, name: node.name };
  }
  return null;
}

interface ArtifactTreeProps {
  className?: string;
}

const ALL_SECTION_IDS = [
  'pins',
  'recent',
  'blueprints',
  'todos',
  'embeds',
  'images',
  'diagrams',
  'documents',
  'designs',
  'spreadsheets',
  'code-files',
  'snippets',
  'archived-blueprints',
];

interface ContextMenuState {
  node?: TreeNode;
  nodes?: TreeNode[];
  x: number;
  y: number;
}

function resolveSelectedNodes(
  selectedIds: Set<string>,
  allNodes: TreeNode[],
): { resolved: TreeNode[]; missing: string[] } {
  const resolved = allNodes.filter((n) => selectedIds.has(n.id));
  const presentIds = new Set(resolved.map((n) => n.id));
  const missing = Array.from(selectedIds).filter((id) => !presentIds.has(id));
  return { resolved, missing };
}

function toArtifactNode(
  item: { id: string; name: string; deprecated?: boolean; pinned?: boolean; lastModified?: number },
  artifactType: ArtifactType,
): TreeNode {
  return {
    id: item.id,
    kind: 'artifact',
    artifactType,
    name: item.name,
    deprecated: item.deprecated,
    pinned: item.pinned,
    lastModified: item.lastModified,
  };
}

export function ArtifactTree({ className }: ArtifactTreeProps) {
  const currentSession = useSessionStore((s) => s.currentSession);
  const diagrams = useSessionStore((s) => s.diagrams);
  const documents = useSessionStore((s) => s.documents);
  const designs = useSessionStore((s) => s.designs);
  const spreadsheets = useSessionStore((s) => s.spreadsheets);
  const snippets = useSessionStore((s) => s.snippets);
  const codeFiles = useSessionStore((s) => s.codeFiles);
  const embeds = useSessionStore((s) => s.embeds);
  const images = useSessionStore((s) => s.images);

  const selectedDiagramId = useSessionStore((s) => s.selectedDiagramId);
  const selectedDocumentId = useSessionStore((s) => s.selectedDocumentId);
  const selectedDesignId = useSessionStore((s) => s.selectedDesignId);
  const selectedSpreadsheetId = useSessionStore((s) => s.selectedSpreadsheetId);
  const selectedSnippetId = useSessionStore((s) => s.selectedSnippetId);

  const selectDiagram = useSessionStore((s) => s.selectDiagram);
  const selectDocument = useSessionStore((s) => s.selectDocument);
  const selectDesign = useSessionStore((s) => s.selectDesign);
  const selectSpreadsheet = useSessionStore((s) => s.selectSpreadsheet);
  const selectSnippet = useSessionStore((s) => s.selectSnippet);
  const collabState = useSessionStore((s) => s.collabState);

  const { activeTabId, tabs } = useSessionTabs();
  const activeTabDescriptor = tabs.find((t) => t.id === activeTabId) ?? null;

  const collapsedSections = useSidebarTreeStore((s) => s.collapsedSections);
  const forceExpandedSections = useSidebarTreeStore((s) => s.forceExpandedSections);
  const showDeprecated = useSidebarTreeStore((s) => s.showDeprecated);
  const searchQuery = useSidebarTreeStore((s) => s.searchQuery);
  const toggleSection = useSidebarTreeStore((s) => s.toggleSection);
  const setShowDeprecated = useSidebarTreeStore((s) => s.setShowDeprecated);
  const setSearchQuery = useSidebarTreeStore((s) => s.setSearchQuery);
  const setForceExpandedSections = useSidebarTreeStore(
    (s) => s.setForceExpandedSections,
  );
  const activeTab = useSidebarTreeStore((s) => s.activeTab);
  const setActiveTab = useSidebarTreeStore((s) => s.setActiveTab);
  const collapseAllItems = useSidebarTreeStore((s) => s.collapseAllItems);
  const expandAllItems = useSidebarTreeStore((s) => s.expandAllItems);
  const collapseAllPseudo = useSidebarTreeStore((s) => s.collapseAllPseudo);
  const expandAllPseudo = useSidebarTreeStore((s) => s.expandAllPseudo);
  const multiSelection = useSidebarTreeStore((s) => s.multiSelection);
  const setSelection = useSidebarTreeStore((s) => s.setSelection);
  const toggleInSelection = useSidebarTreeStore((s) => s.toggleInSelection);
  const extendSelectionTo = useSidebarTreeStore((s) => s.extendSelectionTo);
  const clearSelection = useSidebarTreeStore((s) => s.clearSelection);

  const [pseudoFileList, setPseudoFileList] = useState<PseudoFileSummary[]>([]);
  const selectedPseudoPathForTree =
    activeTabDescriptor?.kind === 'code-file' ? activeTabDescriptor.artifactId : '';

  const openPermanent = useTabsStore((s) => s.openPermanent);
  const openPreview = useTabsStore((s) => s.openPreview);

  const removeDiagram = useSessionStore((s) => s.removeDiagram);
  const removeDocument = useSessionStore((s) => s.removeDocument);
  const removeDesign = useSessionStore((s) => s.removeDesign);
  const removeSpreadsheet = useSessionStore((s) => s.removeSpreadsheet);
  const removeSnippet = useSessionStore((s) => s.removeSnippet);
  const removeImage = useSessionStore((s) => s.removeImage);
  const removeEmbed = useSessionStore((s) => s.removeEmbed);
  const updateDiagram = useSessionStore((s) => s.updateDiagram);
  const updateDocument = useSessionStore((s) => s.updateDocument);
  const updateDesign = useSessionStore((s) => s.updateDesign);
  const updateSpreadsheet = useSessionStore((s) => s.updateSpreadsheet);
  const updateSnippet = useSessionStore((s) => s.updateSnippet);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<TreeNode[] | null>(null);

  // Build base node lists (before search/deprecated filter)
  const pinnedNodes = useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = [];
    for (const d of diagrams) if (d.pinned) out.push(toArtifactNode(d, 'diagram'));
    for (const d of documents) if (d.pinned) out.push(toArtifactNode(d, 'document'));
    for (const d of designs) if (d.pinned) out.push(toArtifactNode(d, 'design'));
    for (const s of spreadsheets) if (s.pinned) out.push(toArtifactNode(s, 'spreadsheet'));
    for (const s of snippets) if ((s as any).pinned) out.push(toArtifactNode(s as any, 'snippet'));
    for (const i of images) if ((i as any).pinned) out.push(toArtifactNode(i as any, 'image'));
    return out;
  }, [diagrams, documents, designs, spreadsheets, snippets, images]);

  const recentlyUpdatedNodes = useMemo<TreeNode[]>(() => {
    type Entry = { node: TreeNode; lastModified: number };
    const entries: Entry[] = [];
    const push = (
      item: { id: string; name: string; deprecated?: boolean; pinned?: boolean; lastModified?: number },
      artifactType: ArtifactType,
    ) => {
      if (typeof item.lastModified !== 'number') return;
      entries.push({ node: toArtifactNode(item, artifactType), lastModified: item.lastModified });
    };
    for (const d of diagrams) push(d as any, 'diagram');
    for (const d of documents) {
      if (d.name.endsWith('vibeinstructions')) continue;
      if ((d as any).blueprint === true) continue;
      push(d as any, 'document');
    }
    for (const d of designs) push(d as any, 'design');
    for (const s of spreadsheets) push(s as any, 'spreadsheet');
    for (const s of snippets) push(s as any, 'snippet');
    for (const i of images) push(i as any, 'image');
    if (entries.length === 0) return [];
    entries.sort((a, b) => b.lastModified - a.lastModified);
    const newest = entries[0].lastModified;
    const cutoff = newest - 60_000;
    return entries.filter((e) => e.lastModified >= cutoff).map((e) => e.node);
  }, [diagrams, documents, designs, spreadsheets, snippets, images]);

  const allBlueprintNodes = useMemo<TreeNode[]>(
    () =>
      selectBlueprintNodes(documents as any).map((d) => ({
        id: d.id,
        kind: 'blueprint',
        name: d.name,
        deprecated: d.deprecated,
        lastModified: (d as any).lastModified,
      })),
    [documents],
  );
  const blueprintNodes = useMemo<TreeNode[]>(
    () => allBlueprintNodes.filter((n) => !n.deprecated),
    [allBlueprintNodes],
  );
  const archivedBlueprintNodes = useMemo<TreeNode[]>(
    () => allBlueprintNodes.filter((n) => n.deprecated),
    [allBlueprintNodes],
  );

  const embedNodes = useMemo<TreeNode[]>(
    () => embeds.map((e) => ({ id: e.id, kind: 'embed', name: e.name })),
    [embeds],
  );

  const imageNodes = useMemo<TreeNode[]>(
    () => images.map((img) => toArtifactNode(img as any, 'image')),
    [images],
  );

  const diagramNodes = useMemo<TreeNode[]>(
    () => diagrams.map((d) => toArtifactNode(d, 'diagram')),
    [diagrams],
  );

  const documentNodes = useMemo<TreeNode[]>(
    () =>
      selectCatchAllDocuments(documents as any).map((d) =>
        toArtifactNode(d as any, 'document'),
      ),
    [documents],
  );

  const designNodes = useMemo<TreeNode[]>(
    () => designs.map((d) => toArtifactNode(d, 'design')),
    [designs],
  );

  const spreadsheetNodes = useMemo<TreeNode[]>(
    () => spreadsheets.map((s) => toArtifactNode(s, 'spreadsheet')),
    [spreadsheets],
  );

  const codeFileNodes = useMemo<TreeNode[]>(
    () =>
      codeFiles
        .map((f) => toArtifactNode(f as any, 'code'))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [codeFiles],
  );

  const snippetNodes = useMemo<TreeNode[]>(
    () => snippets.map((s) => toArtifactNode(s as any, 'snippet')),
    [snippets],
  );

  const taskGraphDoc = useMemo(
    () => documents.find((d) => d.name === 'task-graph') ?? null,
    [documents],
  );

  const hasActiveBlueprints = useMemo(
    () =>
      documents.some(
        (d) =>
          d.blueprint === true &&
          !d.deprecated &&
          !d.name.endsWith('vibeinstructions'),
      ),
    [documents],
  );
  const hasBatches = !!(collabState?.batches && collabState.batches.length > 0);
  const isImplementationPhase = hasBatches && hasActiveBlueprints;

  const taskNodes = useMemo<TreeNode[]>(() => {
    if (!isImplementationPhase) return [];
    const nodes: TreeNode[] = [
      { id: '__task_graph__', kind: 'task-graph', name: 'Task Graph' },
    ];
    if (taskGraphDoc) {
      nodes.push({
        id: taskGraphDoc.id,
        kind: 'task-details',
        name: 'Task Details',
      });
    }
    return nodes;
  }, [isImplementationPhase, taskGraphDoc]);

  // Apply visible filter: deprecated and search
  const { visibleNodes, sectionsWithMatches } = useMemo(() => {
    const sections: TreeSection[] = [
      { id: 'pins', leaves: pinnedNodes.map((n) => ({ id: n.id, name: n.name })) },
      {
        id: 'recent',
        leaves: recentlyUpdatedNodes.map((n) => ({ id: n.id, name: n.name })),
      },
      {
        id: 'blueprints',
        leaves: [...blueprintNodes, ...taskNodes].map((n) => ({ id: n.id, name: n.name })),
      },
      { id: 'embeds', leaves: embedNodes.map((n) => ({ id: n.id, name: n.name })) },
      { id: 'images', leaves: imageNodes.map((n) => ({ id: n.id, name: n.name })) },
      { id: 'diagrams', leaves: diagramNodes.map((n) => ({ id: n.id, name: n.name })) },
      { id: 'documents', leaves: documentNodes.map((n) => ({ id: n.id, name: n.name })) },
      { id: 'designs', leaves: designNodes.map((n) => ({ id: n.id, name: n.name })) },
      {
        id: 'spreadsheets',
        leaves: spreadsheetNodes.map((n) => ({ id: n.id, name: n.name })),
      },
      { id: 'code-files', leaves: codeFileNodes.map((n) => ({ id: n.id, name: n.name })) },
      { id: 'snippets', leaves: snippetNodes.map((n) => ({ id: n.id, name: n.name })) },
      {
        id: 'archived-blueprints',
        leaves: archivedBlueprintNodes.map((n) => ({ id: n.id, name: n.name })),
      },
    ];
    return filterTreeBySearch(sections, searchQuery);
  }, [
    pinnedNodes,
    recentlyUpdatedNodes,
    blueprintNodes,
    archivedBlueprintNodes,
    taskNodes,
    embedNodes,
    imageNodes,
    diagramNodes,
    documentNodes,
    designNodes,
    spreadsheetNodes,
    codeFileNodes,
    snippetNodes,
    searchQuery,
  ]);

  // Sync forceExpandedSections based on search matches
  useEffect(() => {
    if (searchQuery.trim() === '') return;
    setForceExpandedSections(Array.from(sectionsWithMatches));
  }, [searchQuery, sectionsWithMatches, setForceExpandedSections]);

  // Load code file list when the code tab becomes active or session changes.
  // Fetches every source file in the project plus any pseudo-indexed metadata,
  // then merges them: pseudo-indexed files keep their method/export counts;
  // un-indexed files appear in the tree with zero counts (no badge shown).
  useEffect(() => {
    if (activeTab !== 'code' || !currentSession) return;
    let cancelled = false;
    const project = currentSession.project;
    Promise.all([
      api.listAllProjectFiles(project).then((r) => r.entries),
      fetchPseudoFiles(project).catch((err) => {
        console.warn('[ArtifactTree] fetchPseudoFiles failed (non-fatal)', err);
        return [] as PseudoFileSummary[];
      }),
    ])
      .then(([allFiles, pseudoFiles]) => {
        if (cancelled) return;
        const projectPrefix = project.endsWith('/') ? project : project + '/';
        // Key pseudo meta by BOTH absolute path and relative-path so we can
        // find matches regardless of which form the pseudo-db stored.
        const metaByAny = new Map<string, PseudoFileSummary>();
        for (const p of pseudoFiles) {
          metaByAny.set(p.filePath, p);
          if (p.filePath.startsWith(projectPrefix)) {
            metaByAny.set(p.filePath.slice(projectPrefix.length), p);
          }
        }
        const merged: PseudoFileSummary[] = allFiles.map((f) => {
          // Always canonicalise filePath as `${project}/${relativePath}` so
          // PseudoTreeBody's toRelative() strips it into a clean relative
          // path for buildTree — otherwise the tree falls back to a flat
          // list because startsWith() misses due to trailing-slash or
          // symlink differences.
          const canonical = `${projectPrefix}${f.relativePath}`;
          const meta = metaByAny.get(f.path) ?? metaByAny.get(f.relativePath);
          if (meta) return { ...meta, filePath: canonical };
          return {
            filePath: canonical,
            title: f.name,
            methodCount: 0,
            exportCount: 0,
            lastUpdated: '',
          };
        });
        setPseudoFileList(merged);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ArtifactTree] listAllProjectFiles failed', err);
          setPseudoFileList([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentSession]);

  const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.filter((n) => {
      if (!showDeprecated && n.deprecated) return false;
      if (searchQuery.trim() !== '' && !visibleNodes.has(n.id)) return false;
      return true;
    });
  };

  const visibleOrder = useMemo<string[]>(() => {
    const sortChildren = (nodes: TreeNode[]): VisibleTreeNode[] =>
      filterNodes(nodes)
        .slice()
        .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
        .map((n) => ({ id: n.id }));

    const sectionDefs: Array<{ id: string; nodes: TreeNode[] }> = [
      { id: 'pins', nodes: pinnedNodes },
      { id: 'recent', nodes: recentlyUpdatedNodes },
      { id: 'blueprints', nodes: [...blueprintNodes, ...taskNodes] },
      { id: 'embeds', nodes: embedNodes },
      { id: 'images', nodes: imageNodes },
      { id: 'diagrams', nodes: diagramNodes },
      { id: 'documents', nodes: documentNodes },
      { id: 'designs', nodes: designNodes },
      { id: 'spreadsheets', nodes: spreadsheetNodes },
      { id: 'code-files', nodes: codeFileNodes },
      { id: 'snippets', nodes: snippetNodes },
      { id: 'archived-blueprints', nodes: archivedBlueprintNodes },
    ];

    const roots: VisibleTreeNode[] = sectionDefs.map((s) => ({
      id: s.id,
      children: sortChildren(s.nodes),
    }));

    // Build effective collapsed set: collapsed XOR forceExpanded
    const effectiveCollapsed = new Set<string>();
    for (const id of collapsedSections) {
      if (!forceExpandedSections.has(id)) effectiveCollapsed.add(id);
    }

    const sectionIds = new Set(sectionDefs.map((s) => s.id));
    return orderVisibleNodes(roots, effectiveCollapsed).filter((id) => !sectionIds.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pinnedNodes,
    recentlyUpdatedNodes,
    blueprintNodes,
    archivedBlueprintNodes,
    taskNodes,
    embedNodes,
    imageNodes,
    diagramNodes,
    documentNodes,
    designNodes,
    spreadsheetNodes,
    codeFileNodes,
    snippetNodes,
    collapsedSections,
    forceExpandedSections,
    showDeprecated,
    searchQuery,
    visibleNodes,
  ]);

  const keyboardHandlersRef = useRef<{
    allVisibleTreeNodes: TreeNode[];
    handleMenuAction: (actionId: string, targetNodes: TreeNode[]) => void;
  }>({ allVisibleTreeNodes: [], handleMenuAction: () => {} });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const currentSelection = useSidebarTreeStore.getState().multiSelection;
      if (currentSelection.ids.size === 0) return;
      // Don't hijack keys when user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape') {
        useSidebarTreeStore.getState().clearSelection();
        return;
      }
      if (e.key === 'Delete' && currentSelection.ids.size >= 1) {
        const { allVisibleTreeNodes, handleMenuAction } = keyboardHandlersRef.current;
        const { resolved, missing } = resolveSelectedNodes(currentSelection.ids, allVisibleTreeNodes);
        if (missing.length > 0) {
          console.warn('[ArtifactTree] selection contains ids not in visible artifact set; skipping:', missing);
        }
        if (resolved.length > 0) {
          e.preventDefault();
          if (resolved.length > 1) {
            setPendingBatchDelete(resolved);
          } else {
            handleMenuAction('delete', resolved);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionKeyForClear = currentSession ? `${currentSession.project}::${currentSession.name}` : null;
  React.useEffect(() => {
    clearSelection();
  }, [sessionKeyForClear, clearSelection]);

  const noSession = !currentSession;

  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!currentSession) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        await importArtifact(currentSession.project, currentSession.name, file);
      } catch (err) {
        console.error('[ArtifactTree] Failed to import file', file.name, err);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!currentSession) return;
    for (const file of files) {
      try {
        await importArtifact(currentSession.project, currentSession.name, file);
      } catch (err) {
        console.error('[ArtifactTree] Failed to import file', file.name, err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadDocumentContent = async (id: string) => {
    if (!currentSession) return;
    try {
      const doc = await api.getDocument(
        currentSession.project,
        currentSession.name,
        id,
      );
      if (doc) updateDocument(id, { content: doc.content });
    } catch (err) {
      console.error('[ArtifactTree] getDocument failed', err);
    }
  };

  const openNode = (node: TreeNode) => {
    if (node.kind === 'artifact' && node.artifactType) {
      switch (node.artifactType) {
        case 'diagram':
          selectDiagram(node.id);
          break;
        case 'document':
          selectDocument(node.id);
          loadDocumentContent(node.id);
          break;
        case 'design':
          selectDesign(node.id);
          break;
        case 'spreadsheet':
          selectSpreadsheet(node.id);
          break;
        case 'snippet':
          selectSnippet(node.id);
          break;
        case 'image':
          break;
      }
    } else if (node.kind === 'embed') {
      // handled by openPermanent
    } else if (node.kind === 'blueprint') {
      selectDocument(node.id);
      loadDocumentContent(node.id);
    } else if (node.kind === 'task-graph') {
      // handled by openPermanent
    } else if (node.kind === 'task-details') {
      selectDocument(node.id);
      loadDocumentContent(node.id);
    }
  };

  const handleNodeClick = React.useCallback(
    (node: TreeNode, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        toggleInSelection(node.id, node.id);
        return;
      }
      if (e.shiftKey) {
        extendSelectionTo(node.id, visibleOrder);
        return;
      }
      setSelection([node.id], node.id);
      openNode(node);
      const d = toTabDescriptor(node);
      if (d) {
        openPreview(d);
      }
    },
    [toggleInSelection, extendSelectionTo, setSelection, visibleOrder, openPreview, openNode],
  );

  const isSelected = (node: TreeNode): boolean => {
    if (node.kind === 'artifact') {
      switch (node.artifactType) {
        case 'diagram':
          return selectedDiagramId === node.id;
        case 'document':
          return selectedDocumentId === node.id;
        case 'design':
          return selectedDesignId === node.id;
        case 'spreadsheet':
          return selectedSpreadsheetId === node.id;
        case 'snippet':
          return selectedSnippetId === node.id;
        case 'image':
          return (
            activeTabDescriptor?.kind === 'artifact' &&
            activeTabDescriptor.artifactType === 'image' &&
            activeTabDescriptor.artifactId === node.id
          );
      }
    } else if (node.kind === 'embed') {
      return (
        activeTabDescriptor?.kind === 'embed' &&
        activeTabDescriptor.artifactId === node.id
      );
    } else if (node.kind === 'blueprint') {
      return selectedDocumentId === node.id;
    } else if (node.kind === 'task-graph') {
      return activeTabDescriptor?.kind === 'task-graph';
    } else if (node.kind === 'task-details') {
      return selectedDocumentId === node.id;
    }
    return false;
  };

  const allVisibleTreeNodes = useMemo<TreeNode[]>(() => {
    const byId = new Map<string, TreeNode>();
    for (const n of [
      ...pinnedNodes,
      ...recentlyUpdatedNodes,
      ...blueprintNodes,
      ...taskNodes,
      ...embedNodes,
      ...imageNodes,
      ...diagramNodes,
      ...documentNodes,
      ...designNodes,
      ...spreadsheetNodes,
      ...codeFileNodes,
      ...snippetNodes,
      ...archivedBlueprintNodes,
    ]) {
      if (!byId.has(n.id)) byId.set(n.id, n);
    }
    return Array.from(byId.values());
  }, [
    pinnedNodes,
    recentlyUpdatedNodes,
    blueprintNodes,
    taskNodes,
    embedNodes,
    imageNodes,
    diagramNodes,
    documentNodes,
    designNodes,
    spreadsheetNodes,
    codeFileNodes,
    snippetNodes,
    archivedBlueprintNodes,
  ]);

  const handleNodeContextMenu = (node: TreeNode, e: React.MouseEvent) => {
    e.preventDefault();
    const selected = multiSelection.ids;
    if (selected.size > 1 && selected.has(node.id)) {
      const { resolved: selectedNodes, missing } = resolveSelectedNodes(selected, allVisibleTreeNodes);
      if (missing.length > 0) {
        console.warn('[ArtifactTree] selection contains ids not in visible artifact set; skipping:', missing);
      }
      setContextMenu({ nodes: selectedNodes, x: e.clientX, y: e.clientY });
    } else {
      setSelection([node.id], node.id);
      setContextMenu({ node, x: e.clientX, y: e.clientY });
    }
  };

  const nodeToItem = (node: TreeNode): Item | null => {
    if (node.kind === 'artifact' && node.artifactType) {
      return {
        id: node.id,
        name: node.name,
        type: node.artifactType as ItemType,
        content: '',
        lastModified: 0,
        deprecated: node.deprecated,
        pinned: node.pinned,
      };
    }
    return null;
  };

  const applyDeprecatedToStore = (node: TreeNode, deprecated: boolean) => {
    if (node.kind === 'blueprint') {
      updateDocument(node.id, { deprecated });
      return;
    }
    if (node.kind !== 'artifact') return;
    switch (node.artifactType) {
      case 'diagram':
        updateDiagram(node.id, { deprecated });
        break;
      case 'document':
        updateDocument(node.id, { deprecated });
        break;
      case 'design':
        updateDesign(node.id, { deprecated });
        break;
      case 'spreadsheet':
        updateSpreadsheet(node.id, { deprecated });
        break;
      case 'snippet':
        updateSnippet(node.id, { deprecated });
        break;
    }
  };

  const performDelete = async (node: TreeNode) => {
    if (!currentSession) return;
    const { project, name: session } = currentSession;
    try {
      if (node.kind === 'embed') {
        const response = await fetch(
          `/api/embed/${encodeURIComponent(node.id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`,
          { method: 'DELETE' },
        );
        if (!response.ok) throw new Error('Failed to delete embed');
        removeEmbed(node.id);
        return;
      }
      if (node.kind !== 'artifact') return;
      switch (node.artifactType) {
        case 'diagram':
          await api.deleteDiagram(project, session, node.id);
          removeDiagram(node.id);
          break;
        case 'document':
          await api.deleteDocument(project, session, node.id);
          removeDocument(node.id);
          break;
        case 'design':
          await api.deleteDesign(project, session, node.id);
          removeDesign(node.id);
          break;
        case 'spreadsheet':
          await api.deleteSpreadsheet(project, session, node.id);
          removeSpreadsheet(node.id);
          break;
        case 'snippet':
          await api.deleteSnippet(project, session, node.id);
          removeSnippet(node.id);
          break;
        case 'image':
          await api.deleteImage(project, session, node.id);
          removeImage(node.id);
          break;
      }
    } catch (err) {
      console.error('[ArtifactTree] delete failed', err);
    }
  };

  const runBatch = async (actionId: string, targetNodes: TreeNode[]) => {
    if (!currentSession) return;
    const batchDeps: BatchDeps = {
      performDelete,
      applyDeprecatedToStore: async (node, deprecated) => {
        await api.setDeprecated(currentSession.project, currentSession.name, node.id, deprecated);
        applyDeprecatedToStore(node, deprecated);
        if (node.kind === 'blueprint' && deprecated) {
          await api.clearTaskGraph(currentSession.project, currentSession.name).catch((err) =>
            console.error('[ArtifactTree] clearTaskGraph failed', err),
          );
        }
      },
    };
    try {
      const result = await runBatchAction(actionId, targetNodes, batchDeps);
      const total = targetNodes.length;
      if (result.failed.length === 0) {
        console.info(`[ArtifactTree] batch ${actionId}: ${result.ok}/${total} succeeded`);
      } else {
        console.warn(
          `[ArtifactTree] batch ${actionId}: ${result.ok}/${total} succeeded, ${result.failed.length} failed`,
          result.failed,
        );
      }
    } catch (err) {
      console.error('[ArtifactTree] batch failed', err);
    }
  };

  const handleMenuAction = async (actionId: string, targetNodes: TreeNode[]) => {
    if (!currentSession) return;
    if (targetNodes.length > 1) {
      const SUPPORTED_BATCH = new Set(['delete', 'deprecate', 'undeprecate']);
      if (!SUPPORTED_BATCH.has(actionId)) {
        console.warn('[ArtifactTree] batch not supported for action', actionId);
        return;
      }
      if (actionId === 'delete') {
        setPendingBatchDelete(targetNodes);
        return;
      }
      await runBatch(actionId, targetNodes);
      return;
    }
    const node = targetNodes[0] ?? contextMenu?.node;
    if (!node) return;
    const { project, name: session } = currentSession;

    switch (actionId) {
      case 'pin-artifact':
        try {
          await api.setPinned(project, session, node.id, !node.pinned);
        } catch (err) {
          console.error('[ArtifactTree] setPinned failed', err);
        }
        break;
      case 'deprecate': {
        const newDeprecated = !node.deprecated;
        try {
          await api.setDeprecated(project, session, node.id, newDeprecated);
          applyDeprecatedToStore(node, newDeprecated);
          // If deprecating a blueprint, also clear the task graph
          if (node.kind === 'blueprint' && newDeprecated) {
            try {
              await api.clearTaskGraph(project, session);
            } catch (err) {
              console.error('[ArtifactTree] clearTaskGraph failed', err);
            }
          }
        } catch (err) {
          console.error('[ArtifactTree] setDeprecated failed', err);
        }
        break;
      }
      case 'download': {
        const item = nodeToItem(node);
        if (!item) break;
        try {
          await downloadArtifact(project, session, item);
        } catch (err) {
          console.error('[ArtifactTree] download failed', err);
        }
        break;
      }
      case 'email': {
        const item = nodeToItem(node);
        if (!item) break;
        try {
          await emailArtifact(project, session, item);
        } catch (err) {
          console.error('[ArtifactTree] email failed', err);
        }
        break;
      }
      case 'delete':
        setPendingDelete(node);
        break;
      case 'sync-from-disk':
        try {
          await api.syncCodeFromDisk(project, session, node.id);
        } catch (err) {
          console.error('[ArtifactTree] syncCodeFromDisk failed', err);
        }
        break;
      case 'push-to-disk':
        try {
          await api.pushCodeToFile(project, session, node.id);
        } catch (err) {
          console.error('[ArtifactTree] pushCodeToFile failed', err);
        }
        break;
      default:
        // Remaining stubbed actions (rename, duplicate, reveal-in-file-browser,
        // unlink, edit/mark-complete on todos) have no underlying API yet.
        console.debug('[ArtifactTree] action not yet supported:', actionId, node);
        break;
    }
  };

  React.useEffect(() => {
    keyboardHandlersRef.current = { allVisibleTreeNodes, handleMenuAction };
  });

  const MULTISELECT_EXCLUDED_SECTIONS = new Set([
    'pins',
    'recent',
    'blueprints',
    'todos',
  ]);

  const renderSection = (
    id: string,
    title: string,
    nodes: TreeNode[],
  ): React.ReactElement | null => {
    const multiselectEnabled = !MULTISELECT_EXCLUDED_SECTIONS.has(id);
    const showSelectedHighlight = id !== 'recent';
    const filtered = filterNodes(nodes)
      .slice()
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    if (filtered.length === 0) return null;
    const isCollapsed = collapsedSections.has(id);
    const isForceExpanded = forceExpandedSections.has(id);
    const showChildren = !isCollapsed || isForceExpanded;
    return (
      <React.Fragment key={id}>
        <SectionBranchRow
          id={id}
          title={title}
          count={filtered.length}
          collapsed={isCollapsed && !isForceExpanded}
          onToggle={() => toggleSection(id)}
          level={0}
        />
        {showChildren &&
          filtered.map((node) => (
            <div key={node.id} style={{ paddingLeft: '16px' }}>
              <ArtifactTreeNode
                node={node}
                selected={showSelectedHighlight && isSelected(node)}
                isInMultiSelection={multiselectEnabled && multiSelection.ids.has(node.id)}
                onClick={(e) => {
                  if (!multiselectEnabled) {
                    setSelection([node.id], node.id);
                    openNode(node);
                    const d = toTabDescriptor(node);
                    if (d) {
                      openPreview(d);
                    }
                    return;
                  }
                  handleNodeClick(node, e);
                }}
                onDoubleClick={() => {
                  openNode(node);
                  const d = toTabDescriptor(node);
                  if (d) openPermanent(d);
                }}
                onContextMenu={(e) => handleNodeContextMenu(node, e)}
                onTogglePin={
                  node.kind === 'artifact' || node.kind === 'blueprint'
                    ? async () => {
                        if (!currentSession) return;
                        try {
                          await api.setPinned(
                            currentSession.project,
                            currentSession.name,
                            node.id,
                            !node.pinned,
                          );
                        } catch (err) {
                          console.error('[ArtifactTree] setPinned failed', err);
                        }
                      }
                    : undefined
                }
              />
            </div>
          ))}
      </React.Fragment>
    );
  };

  if (noSession) {
    return (
      <div
        data-testid="sidebar-empty"
        className="p-4 text-sm text-gray-500"
      >
        Select a session
      </div>
    );
  }

  return (
    <aside
      data-testid="artifact-tree"
      className={`flex flex-col w-72 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-hidden ${className ?? ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {multiSelection.ids.size > 1 && (
        <div
          className="flex items-center justify-between px-2 py-1 text-xs border-b border-gray-200 dark:border-gray-700 bg-accent-50 dark:bg-accent-900/30"
          data-testid="selection-summary-bar"
        >
          <span>{multiSelection.ids.size} selected</span>
          <button
            type="button"
            className="text-accent-700 dark:text-accent-300 hover:underline"
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      )}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
        <div role="tablist" aria-label="Sidebar tabs" className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 -mx-2 px-2 pb-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'items'}
            data-testid="sidebar-tab-items"
            onClick={() => setActiveTab('items')}
            className={`px-2 py-1 text-xs rounded ${
              activeTab === 'items'
                ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-semibold'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Items
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'code'}
            data-testid="sidebar-tab-code"
            onClick={() => setActiveTab('code')}
            className={`px-2 py-1 text-xs rounded ${
              activeTab === 'code'
                ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-semibold'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Code
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {activeTab === 'items' ? 'Items' : 'Code'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'items') {
                  collapseAllItems(ALL_SECTION_IDS);
                } else {
                  collapseAllPseudo(getAllDirPaths(pseudoFileList));
                }
              }}
              title="Collapse all"
              aria-label="Collapse all sections"
              className="p-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'items') expandAllItems();
                else expandAllPseudo();
              }}
              title="Expand all"
              aria-label="Expand all sections"
              className="p-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {activeTab === 'items' && (
              <button
                type="button"
                onClick={handleUploadClick}
                title="Upload"
                aria-label="Upload files"
                className="p-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <input
            data-testid="sidebar-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full text-xs pl-2 pr-6 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              title="Clear search"
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        {activeTab === 'items' && (
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={(e) => setShowDeprecated(e.target.checked)}
            />
            Show deprecated
          </label>
        )}
      </div>

      {activeTab === 'code' ? (
        <div className="overflow-y-auto flex-1" role="tree">
          <PseudoTreeBody
            fileList={pseudoFileList}
            currentPath={selectedPseudoPathForTree}
            onNavigate={(stem) => {
              const basename = stem.split('/').pop() || stem;
              openPreview({
                id: `pseudo::${stem}`,
                kind: 'code-file',
                artifactId: stem,
                name: basename,
              });
            }}
            onPermanent={(stem) => {
              const basename = stem.split('/').pop() || stem;
              openPermanent({
                id: `pseudo::${stem}`,
                kind: 'code-file',
                artifactId: stem,
                name: basename,
              });
            }}
            project={currentSession.project}
          />
        </div>
      ) : (
      <div className="overflow-y-auto flex-1 pl-2" role="tree">
        {renderSection('pins', 'Pinned', pinnedNodes)}
        {renderSection('recent', 'Recently Updated', recentlyUpdatedNodes)}
        {renderSection('blueprints', 'Implementing', [...blueprintNodes, ...taskNodes])}
        <TodosTreeSection
          collapsed={collapsedSections.has('todos')}
          onToggle={() => toggleSection('todos')}
        />
        {renderSection('embeds', 'Embeds', embedNodes)}
        {renderSection('images', 'Images', imageNodes)}
        {renderSection('diagrams', 'Diagrams', diagramNodes)}
        {renderSection('documents', 'Documents', documentNodes)}
        {renderSection('designs', 'Designs', designNodes)}
        {renderSection('spreadsheets', 'Spreadsheets', spreadsheetNodes)}
        {renderSection('code-files', 'Code Files', codeFileNodes)}
        {renderSection('snippets', 'Snippets', snippetNodes)}
        {renderSection('archived-blueprints', 'Archived Blueprints', archivedBlueprintNodes)}
      </div>
      )}

      {contextMenu && (
        contextMenu.nodes ? (
          <SidebarNodeContextMenu
            nodes={contextMenu.nodes}
            x={contextMenu.x}
            y={contextMenu.y}
            onAction={(id, targetNodes) => handleMenuAction(id, targetNodes)}
            onClose={() => setContextMenu(null)}
          />
        ) : (
          <SidebarNodeContextMenu
            node={contextMenu.node!}
            x={contextMenu.x}
            y={contextMenu.y}
            actions={getActionsForNode(contextMenu.node!)}
            onAction={(id, targetNodes) => handleMenuAction(id, targetNodes)}
            onClose={() => setContextMenu(null)}
          />
        )
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete artifact"
        message={
          pendingDelete
            ? `Are you sure you want to delete "${pendingDelete.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          const node = pendingDelete;
          setPendingDelete(null);
          if (node) await performDelete(node);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        isOpen={pendingBatchDelete !== null}
        title={pendingBatchDelete ? `Delete ${pendingBatchDelete.length} items?` : ''}
        message={
          pendingBatchDelete
            ? (() => {
                const names = pendingBatchDelete.slice(0, 5).map((n) => n.name);
                const extra = pendingBatchDelete.length - names.length;
                const list = names.join(', ');
                return extra > 0
                  ? `${list}, and ${extra} more. This action cannot be undone.`
                  : `${list}. This action cannot be undone.`;
              })()
            : ''
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          const nodes = pendingBatchDelete;
          setPendingBatchDelete(null);
          if (nodes && nodes.length > 0) await runBatch('delete', nodes);
        }}
        onCancel={() => setPendingBatchDelete(null)}
      />
    </aside>
  );
}

ArtifactTree.displayName = 'ArtifactTree';

export default ArtifactTree;
