/**
 * ArtifactTree — top-level sidebar tree component.
 *
 * Aggregates sessionStore artifact lists into sectioned trees with search,
 * show-deprecated toggle, drag-and-drop upload, and context-menu actions.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../stores/sidebarTreeStore';
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
import {
  getActionsForNode,
  type ArtifactType,
  type TreeNode,
} from './getActionsForNode';
import { importArtifact } from '../../../lib/importArtifact';
import { downloadArtifact } from '../../../lib/downloadArtifact';
import { emailArtifact } from '../../../lib/emailArtifact';
import { api } from '../../../lib/api';
import { useTabsStore } from '../../../stores/tabsStore';
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
  return null;
}

interface ArtifactTreeProps {
  className?: string;
}

const ALL_SECTION_IDS = [
  'pins',
  'blueprints',
  'todos',
  'embeds',
  'images',
  'diagrams',
  'documents',
  'designs',
  'spreadsheets',
  'snippets',
  'archived-blueprints',
];

interface ContextMenuState {
  node: TreeNode;
  x: number;
  y: number;
}

function toArtifactNode(
  item: { id: string; name: string; deprecated?: boolean; pinned?: boolean },
  artifactType: ArtifactType,
): TreeNode {
  return {
    id: item.id,
    kind: 'artifact',
    artifactType,
    name: item.name,
    deprecated: item.deprecated,
    pinned: item.pinned,
  };
}

export function ArtifactTree({ className }: ArtifactTreeProps) {
  const currentSession = useSessionStore((s) => s.currentSession);
  const diagrams = useSessionStore((s) => s.diagrams);
  const documents = useSessionStore((s) => s.documents);
  const designs = useSessionStore((s) => s.designs);
  const spreadsheets = useSessionStore((s) => s.spreadsheets);
  const snippets = useSessionStore((s) => s.snippets);
  const embeds = useSessionStore((s) => s.embeds);
  const images = useSessionStore((s) => s.images);

  const selectedDiagramId = useSessionStore((s) => s.selectedDiagramId);
  const selectedDocumentId = useSessionStore((s) => s.selectedDocumentId);
  const selectedDesignId = useSessionStore((s) => s.selectedDesignId);
  const selectedSpreadsheetId = useSessionStore((s) => s.selectedSpreadsheetId);
  const selectedSnippetId = useSessionStore((s) => s.selectedSnippetId);
  const selectedEmbedId = useSessionStore((s) => s.selectedEmbedId);
  const selectedImageId = useSessionStore((s) => s.selectedImageId);

  const selectDiagram = useSessionStore((s) => s.selectDiagram);
  const selectDocument = useSessionStore((s) => s.selectDocument);
  const selectDesign = useSessionStore((s) => s.selectDesign);
  const selectSpreadsheet = useSessionStore((s) => s.selectSpreadsheet);
  const selectSnippet = useSessionStore((s) => s.selectSnippet);
  const selectEmbed = useSessionStore((s) => s.selectEmbed);
  const selectImage = useSessionStore((s) => s.selectImage);
  const selectTaskGraph = useSessionStore((s) => s.selectTaskGraph);
  const taskGraphSelected = useSessionStore((s) => s.taskGraphSelected);
  const collabState = useSessionStore((s) => s.collabState);

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

  const openPreview = useTabsStore((s) => s.openPreview);
  const openPermanent = useTabsStore((s) => s.openPermanent);

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

  const allBlueprintNodes = useMemo<TreeNode[]>(
    () =>
      selectBlueprintNodes(documents as any).map((d) => ({
        id: d.id,
        kind: 'blueprint',
        name: d.name,
        deprecated: d.deprecated,
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
      { id: 'snippets', leaves: snippetNodes.map((n) => ({ id: n.id, name: n.name })) },
      {
        id: 'archived-blueprints',
        leaves: archivedBlueprintNodes.map((n) => ({ id: n.id, name: n.name })),
      },
    ];
    return filterTreeBySearch(sections, searchQuery);
  }, [
    pinnedNodes,
    blueprintNodes,
    archivedBlueprintNodes,
    taskNodes,
    embedNodes,
    imageNodes,
    diagramNodes,
    documentNodes,
    designNodes,
    spreadsheetNodes,
    snippetNodes,
    searchQuery,
  ]);

  // Sync forceExpandedSections based on search matches
  useEffect(() => {
    if (searchQuery.trim() === '') return;
    setForceExpandedSections(Array.from(sectionsWithMatches));
  }, [searchQuery, sectionsWithMatches, setForceExpandedSections]);

  const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.filter((n) => {
      if (!showDeprecated && n.deprecated) return false;
      if (searchQuery.trim() !== '' && !visibleNodes.has(n.id)) return false;
      return true;
    });
  };

  if (!currentSession) {
    return (
      <div
        data-testid="sidebar-empty"
        className="p-4 text-sm text-gray-500"
      >
        Select a session
      </div>
    );
  }

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
          selectImage(node.id);
          break;
      }
    } else if (node.kind === 'embed') {
      selectEmbed(node.id);
    } else if (node.kind === 'blueprint') {
      selectDocument(node.id);
      loadDocumentContent(node.id);
    } else if (node.kind === 'task-graph') {
      selectTaskGraph();
    } else if (node.kind === 'task-details') {
      selectDocument(node.id);
      loadDocumentContent(node.id);
    }
  };

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
          return selectedImageId === node.id;
      }
    } else if (node.kind === 'embed') {
      return selectedEmbedId === node.id;
    } else if (node.kind === 'blueprint') {
      return selectedDocumentId === node.id;
    } else if (node.kind === 'task-graph') {
      return taskGraphSelected;
    } else if (node.kind === 'task-details') {
      return selectedDocumentId === node.id;
    }
    return false;
  };

  const onContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ node, x: e.clientX, y: e.clientY });
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

  const handleMenuAction = async (actionId: string) => {
    const node = contextMenu?.node;
    if (!node || !currentSession) return;
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

  const renderSection = (
    id: string,
    title: string,
    nodes: TreeNode[],
  ): React.ReactElement | null => {
    const filtered = filterNodes(nodes);
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
                selected={isSelected(node)}
                onClick={() => {
                  openNode(node);
                  const d = toTabDescriptor(node);
                  if (d) openPreview(d);
                }}
                onDoubleClick={() => {
                  openNode(node);
                  const d = toTabDescriptor(node);
                  if (d) openPermanent(d);
                }}
                onContextMenu={(e) => onContextMenu(e, node)}
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

  return (
    <aside
      data-testid="artifact-tree"
      className={`flex flex-col w-72 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-hidden ${className ?? ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Items
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
              onClick={() =>
                useSidebarTreeStore.setState({
                  collapsedSections: new Set(ALL_SECTION_IDS),
                })
              }
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
              onClick={() =>
                useSidebarTreeStore.setState({ collapsedSections: new Set() })
              }
              title="Expand all"
              aria-label="Expand all sections"
              className="p-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
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
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
      </div>

      <div className="overflow-y-auto flex-1 pl-2" role="tree">
        {renderSection('pins', 'Pinned', pinnedNodes)}
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
        {renderSection('snippets', 'Snippets', snippetNodes)}
        {renderSection('archived-blueprints', 'Archived Blueprints', archivedBlueprintNodes)}
      </div>

      {contextMenu && (
        <SidebarNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={getActionsForNode(contextMenu.node)}
          onAction={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
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
    </aside>
  );
}

ArtifactTree.displayName = 'ArtifactTree';

export default ArtifactTree;
