/**
 * Heading-based collapsible sections for Milkdown.
 *
 * Two pieces:
 *   1. A heading NodeView that renders an inline chevron button before the
 *      heading's content. Clicking it toggles the section in the shared React
 *      context provided by `CollapsibleSectionsProvider`.
 *   2. A ProseMirror plugin that walks the doc after each transaction and, for
 *      every collapsed heading, adds `Decoration.node` with class
 *      `section-collapsed` to each following block up to (but not including)
 *      the next heading with level <= L. CSS hides these blocks.
 *
 * Bridge between the React context and the PM plugin is a module-level
 * `collapseStateRef`. A React hook (`useHeadingCollapseBridge`) subscribes to
 * context state and, on change, updates the ref and dispatches a
 * pluginKey meta transaction so the plugin's `apply` recomputes.
 *
 * sectionId is derived from the PM doc position with a stable shared helper
 * so NodeView and plugin agree on the same id for the same heading.
 */

import React, { useEffect } from 'react';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { editorViewCtx, prosePluginsCtx } from '@milkdown/core';
import { $prose, $view } from '@milkdown/utils';
import { headingSchema } from '@milkdown/preset-commonmark';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorState, Transaction } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView, NodeViewConstructor } from '@milkdown/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/prose/model';
import { useNodeViewFactory, useNodeViewContext } from '@prosemirror-adapter/react';
import { useInstance } from '@milkdown/react';

import { useCollapsibleSectionsSafe, ChevronIcon } from '../../CollapsibleSection';

type NodeViewFactory = ReturnType<typeof useNodeViewFactory>;

/** Stable section id from a heading's doc position. */
export function getHeadingSectionId(pos: number): string {
  return `heading-${pos}`;
}

/** Shared state bridge updated by useHeadingCollapseBridge. */
interface CollapseStateRef {
  expanded: Set<string>;
  /** Sections the React context knows about (registered by NodeViews).
   * Section IDs are position-based; unknown IDs default to expanded so that
   * typing — which shifts positions — doesn't auto-collapse everything. */
  knownSections: Set<string>;
  /** Sections observed by the PM plugin during buildDecorations. */
  allSections: Set<string>;
  version: number;
}

const collapseStateRef: CollapseStateRef = {
  expanded: new Set<string>(),
  knownSections: new Set<string>(),
  allSections: new Set<string>(),
  version: 0,
};

export const headingCollapsePluginKey = new PluginKey<{
  decorations: DecorationSet;
  version: number;
}>('heading-collapse');

const BUMP_META = 'heading-collapse-bump';

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decos: Decoration[] = [];
  // Record all heading section ids we see, so the context can know the
  // full set for Expand/Collapse All.
  const seen: { id: string; level: number; pos: number; end: number }[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = (node.attrs?.level ?? 1) as number;
      seen.push({
        id: getHeadingSectionId(pos),
        level,
        pos,
        end: pos + node.nodeSize,
      });
    }
    // Only traverse top-level blocks — headings are top-level.
    return false;
  });

  // Stamp every top-level block with `section-level-N` where N is the level
  // of the most recent heading — lets CSS indent whole sections.
  {
    let currentLevel = 0;
    doc.forEach((child, offset) => {
      if (child.type.name === 'heading') {
        currentLevel = (child.attrs?.level ?? 1) as number;
      }
      if (currentLevel >= 2) {
        decos.push(
          Decoration.node(offset, offset + child.nodeSize, {
            class: `section-level-${currentLevel}`,
          }),
        );
      }
    });
  }

  // For each collapsed heading, find the range of following siblings up to
  // the next heading with level <= L, and mark each as collapsed.
  //
  // Collapse semantics: ID must be known (registered by a NodeView) AND
  // not in `expanded`. Unknown IDs default to expanded — this is important
  // because section IDs are position-based and shift with every edit; the
  // plugin sees fresh positions before the React registerSection effect
  // has caught up, so without this guard every keystroke would collapse
  // every section.
  for (let i = 0; i < seen.length; i++) {
    const h = seen[i];
    const known = collapseStateRef.knownSections.has(h.id);
    const expanded = collapseStateRef.expanded.has(h.id);
    if (!known || expanded) continue;
    // Collect blocks to collapse: walk siblings after this heading.
    // Since headings are direct children of the doc, iterate the doc's
    // children array starting at the heading's index.
    // We re-scan to find children indices because pos math is simpler via
    // doc.forEach.
    let started = false;
    let childOffset = 0;
    doc.forEach((child, offset) => {
      if (!started) {
        if (offset === h.pos) started = true;
        childOffset = offset;
        return;
      }
      // Stop at next heading with level <= h.level
      if (child.type.name === 'heading') {
        const lvl = (child.attrs?.level ?? 1) as number;
        if (lvl <= h.level) {
          started = false;
          return;
        }
      }
      const from = offset;
      const to = offset + child.nodeSize;
      decos.push(
        Decoration.node(from, to, { class: 'section-collapsed' }),
      );
      childOffset = offset;
    });
    // silence unused
    void childOffset;
    void started;
  }

  // Publish seen ids to the shared bridge so expandAll can see them.
  collapseStateRef.allSections = new Set(seen.map((s) => s.id));

  return DecorationSet.create(doc, decos);
}

export function createHeadingCollapsePlugin(): Plugin {
  return new Plugin<{ decorations: DecorationSet; version: number }>({
    key: headingCollapsePluginKey,
    state: {
      init(_config, state) {
        return {
          decorations: buildDecorations(state.doc),
          version: collapseStateRef.version,
        };
      },
      apply(tr: Transaction, value, _oldState, newState) {
        const bump = tr.getMeta(BUMP_META);
        if (bump !== undefined || tr.docChanged) {
          return {
            decorations: buildDecorations(newState.doc),
            version: collapseStateRef.version,
          };
        }
        return value;
      },
    },
    props: {
      decorations(state: EditorState) {
        return headingCollapsePluginKey.getState(state)?.decorations;
      },
    },
  });
}

/** Milkdown plugin wrapper that registers the PM plugin via prosePluginsCtx. */
export const headingCollapsePlugin: MilkdownPlugin[] = [
  $prose(() => createHeadingCollapsePlugin()),
].flat() as MilkdownPlugin[];

/**
 * React component rendering the heading NodeView: chevron + contentDOM host.
 */
function HeadingCollapseView() {
  const { node, contentRef, getPos } = useNodeViewContext();
  const context = useCollapsibleSectionsSafe();
  const level = Math.max(1, Math.min(6, (node.attrs?.level ?? 1) as number));
  const pos = typeof getPos === 'function' ? getPos() : undefined;
  const sectionId = typeof pos === 'number' ? getHeadingSectionId(pos) : 'heading-unknown';

  const isExpanded = context ? context.expandedSections.has(sectionId) : true;

  // Register section with context when it mounts / id changes.
  const registeredRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!context) return;
    if (registeredRef.current !== sectionId) {
      registeredRef.current = sectionId;
      context.registerSection(sectionId);
    }
  }, [context, sectionId]);

  const onToggle = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      context?.toggleSection(sectionId);
    },
    [context, sectionId],
  );

  const Tag = `h${level}`;

  return React.createElement(
    Tag,
    { className: 'heading-collapsible' },
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: onToggle,
        onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
        className:
          'heading-collapse-chevron inline-flex align-middle mr-1 text-gray-600 dark:text-gray-300 hover:opacity-80',
        contentEditable: false,
        'aria-expanded': isExpanded,
        'aria-controls': `section-content-${sectionId}`,
        'data-section-id': sectionId,
        'data-testid': `heading-collapse-chevron-${sectionId}`,
      },
      React.createElement(ChevronIcon, { isExpanded }),
    ),
    React.createElement('span', {
      ref: contentRef,
      className: 'heading-collapsible-content',
    }),
  );
}

/** Creates the heading $view that installs our NodeView for headings. */
export function headingCollapseNodeView(nodeViewFactory: NodeViewFactory) {
  return $view(headingSchema.node, () =>
    nodeViewFactory({
      component: HeadingCollapseView,
    }) as NodeViewConstructor,
  );
}

/**
 * React hook: subscribes to the collapsible-sections context and keeps the
 * module-level bridge in sync. Also dispatches a meta transaction so the PM
 * plugin recomputes its decoration set on state changes.
 *
 * Call this once inside the editor tree (it uses `useInstance` to get the
 * EditorView, same pattern as other milkdown react hooks).
 */
export function useHeadingCollapseBridge(): void {
  const context = useCollapsibleSectionsSafe();
  const [loading, getEditor] = useInstance();

  useEffect(() => {
    if (!context) return;
    collapseStateRef.expanded = new Set(context.expandedSections);
    collapseStateRef.knownSections = new Set(context.allSections);
    collapseStateRef.version += 1;
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    // Defer to a microtask: the PM react-adapter uses flushSync inside its
    // render path, and dispatching synchronously from this effect triggers a
    // "flushSync was called from inside a lifecycle method" warning.
    const handle = queueMicrotask(() => {
      try {
        editor.action((ctx) => {
          const view: EditorView | undefined = ctx.get(editorViewCtx);
          if (!view) return;
          view.dispatch(
            view.state.tr.setMeta(BUMP_META, collapseStateRef.version),
          );
        });
      } catch {
        // editor not ready
      }
    });
    void handle;
  }, [context, context?.expandedSections, context?.allSections, loading, getEditor]);
}

/** Test-only: reset the module-level bridge (used by unit tests). */
export function __resetHeadingCollapseStateForTests() {
  collapseStateRef.expanded = new Set();
  collapseStateRef.knownSections = new Set();
  collapseStateRef.allSections = new Set();
  collapseStateRef.version = 0;
}

/** Test-only: set the expanded + known-sections sets directly. When only
 *  `expanded` is passed, `knownSections` defaults to the same IDs. */
export function __setHeadingCollapseExpandedForTests(
  ids: Iterable<string>,
  knownIds?: Iterable<string>,
) {
  collapseStateRef.expanded = new Set(ids);
  collapseStateRef.knownSections = new Set(knownIds ?? ids);
  collapseStateRef.version += 1;
}

// Silence lint for unused prosePluginsCtx import when only using $prose.
void prosePluginsCtx;
