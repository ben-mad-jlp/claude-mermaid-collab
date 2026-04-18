import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx, prosePluginsCtx } from '@milkdown/core';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { EditorView } from '@milkdown/prose/view';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { clipboard } from '@milkdown/plugin-clipboard';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { $view, replaceAll } from '@milkdown/utils';
import {
  useNodeViewFactory,
  ProsemirrorAdapterProvider,
  useNodeViewContext,
} from '@prosemirror-adapter/react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';

import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { autosavePlugin } from './plugins/autosave';
import { rawPositionsPlugin } from './plugins/rawPositions';
import { diagramEmbedNode, diagramEmbedRemarkPlugin } from './plugins/diagramEmbed';
import { DiagramEmbedView } from './plugins/diagramEmbedView';
import { detailsNode, rawDetailsRemarkPlugin, DetailsView } from './plugins/rawDetails';
import { fidelityPlugins } from './serializerConfig';
import { codeBlockPrismPlugin } from './plugins/codeBlockPrism';
import {
  headingCollapseNodeView,
  headingCollapsePlugin,
  useHeadingCollapseBridge,
} from './plugins/headingCollapse';
import { imageResolverView } from './plugins/imageResolver';
import { emitTelemetry, nowMs } from './plugins/telemetry';
import { createAnnotationsPlugin, setAnnotationsMeta } from './plugins/annotations/decoration';
import type { Annotation } from './plugins/annotations/schema';
import '@milkdown/theme-nord/style.css';
import './milkdown-prose.css';

export interface MilkdownEditorProps {
  docId: string;
  initialMarkdown: string;
  onChange?: (md: string) => void;
  onPersist: (md: string) => void;
  onFlushRef?: MutableRefObject<(() => void) | null>;
  /**
   * Debounce delay for autosave, in ms. Captured at mount — changing this prop
   * after the editor is mounted has no effect. Pass the final value on first
   * render, or leave undefined to use the autosave default (500ms).
   */
  autosaveDelay?: number;
  editable?: boolean;
  annotations?: Annotation[];
  onAnnotationsChange?: (next: Annotation[]) => void;
  /** Fired once after the ProseMirror EditorView is available. */
  onReady?: (view: EditorView) => void;
}

export interface MilkdownEditorHandle {
  setMarkdown(md: string): void;
  getView(): EditorView | null;
}

interface MilkdownInnerProps extends MilkdownEditorProps {
  hostRef: MutableRefObject<HTMLDivElement | null>;
  onChangeRef: MutableRefObject<((md: string) => void) | undefined | null>;
  onPersistRef: MutableRefObject<((md: string) => void) | null>;
  editableRef: MutableRefObject<boolean>;
  annotationsRef: MutableRefObject<Annotation[]>;
  onReadyRef: MutableRefObject<((view: EditorView) => void) | undefined>;
}

const ProjectSessionContext = createContext<{ project?: string; session?: string }>({});

export function useProjectSession() {
  return useContext(ProjectSessionContext);
}

function DetailsViewBridge() {
  return <DetailsView />;
}

function DiagramEmbedViewBridge() {
  const { node, selected } = useNodeViewContext();
  // Can't use useProjectSession() here — prosemirror-adapter mounts each
  // NodeView in a detached React root, so outer context providers aren't
  // reachable. Read the stores directly.
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const currentSession = useSessionStore((s) => s.currentSession);
  const project = selectedProject ?? undefined;
  const session = currentSession?.name ?? undefined;
  const kind = node.attrs.kind;
  const refId = node.attrs.refId;
  return (
    <DiagramEmbedView
      kind={kind}
      refId={refId}
      project={project}
      session={session}
      selected={!!selected}
    />
  );
}

const MilkdownInner = forwardRef<MilkdownEditorHandle, MilkdownInnerProps>(function MilkdownInner(
  {
    docId,
    initialMarkdown,
    onFlushRef,
    autosaveDelay,
    hostRef,
    onChangeRef,
    onPersistRef,
    editableRef,
    annotationsRef,
    onReadyRef,
  },
  ref,
) {
  const nodeViewFactory = useNodeViewFactory();

  // I4: capture autosaveDelay once at mount so later prop changes don't
  // recreate the plugins array (and therefore the entire editor). `undefined`
  // is coerced to the autosave-plugin default (500ms) to avoid locking in
  // an ambiguous captured value.
  const autosaveDelayInitial = useRef(autosaveDelay ?? 500).current;

  const diagramEmbedView = useMemo(
    () =>
      $view(diagramEmbedNode.node, () =>
        nodeViewFactory({ component: DiagramEmbedViewBridge, stopEvent: () => true }),
      ),
    [nodeViewFactory],
  );

  const imageView = useMemo(
    () => imageResolverView(nodeViewFactory),
    [nodeViewFactory],
  );

  const detailsView = useMemo(
    () => $view(detailsNode.node, () => nodeViewFactory({ component: DetailsViewBridge })),
    [nodeViewFactory],
  );

  const headingView = useMemo(
    () => headingCollapseNodeView(nodeViewFactory),
    [nodeViewFactory],
  );

  // Annotations PM plugin: register as a milkdown plugin that pushes a PM
  // plugin into prosePluginsCtx. Reads annotations from the ref so it survives
  // list updates without recreating the editor.
  const annotationsMilkdownPlugin = useMemo<MilkdownPlugin>(() => {
    const plugin: MilkdownPlugin = (ctx) => () => {
      ctx.update(prosePluginsCtx, (prev) => [
        ...prev,
        createAnnotationsPlugin(() => annotationsRef.current),
      ]);
    };
    return plugin;
  }, [annotationsRef]);

  const plugins = useMemo(
    () =>
      [
        // IMPORTANT: rawPositionsPlugin must run BEFORE fidelityPlugins /
        // schema parseMarkdown runners. It stamps `data.style` on mdast
        // `break` nodes and `data.rawTrailing`/`data.marker` on blocks;
        // hardBreakStyle and list/heading/paragraph schemas read those
        // fields to reconstruct original markdown spacing. Reordering this
        // before commonmark/gfm/fidelityPlugins would silently drop
        // break-style and spacing fidelity without test failures unless
        // every style is exercised by fixtures.
        rawPositionsPlugin,
        commonmark,
        gfm,
        codeBlockPrismPlugin,
        history,
        clipboard,
        diagramEmbedRemarkPlugin,
        rawDetailsRemarkPlugin,
        diagramEmbedNode,
        detailsNode,
        ...fidelityPlugins,
        ...autosavePlugin({
          docId,
          onChangeRef,
          onPersistRef,
          onFlushRef,
          delay: autosaveDelayInitial,
        }),
        annotationsMilkdownPlugin,
        ...headingCollapsePlugin,
        diagramEmbedView,
        detailsView,
        headingView,
        imageView,
      ].flat(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, diagramEmbedView, detailsView, headingView, imageView, annotationsMilkdownPlugin],
  );

  useEditor(
    (root) => {
      const host = hostRef.current ?? root;
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, host);
          ctx.set(defaultValueCtx, initialMarkdown);
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => editableRef.current,
          }));
        })
        .use(plugins);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, plugins],
  );

  // Bridge React collapsible-sections context to the PM heading-collapse
  // plugin. Safe to call unconditionally — it no-ops outside a provider.
  useHeadingCollapseBridge();

  useEffect(() => {
    emitTelemetry({
      editor_variant: 'wysiwyg',
      timestamp: Date.now(),
    });
  }, []);

  const [loading, getEditor] = useInstance();

  // Fire onReady once the PM view is available. useInstance flips `loading`
  // to false after the editor mounts, triggering this effect.
  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    try {
      const view = editor.action((ctx) => ctx.get(editorViewCtx));
      onReadyRef.current?.(view);
    } catch {
      // view not ready yet — ignore
    }
  }, [loading, getEditor, onReadyRef]);

  useImperativeHandle(
    ref,
    () => ({
      setMarkdown(md: string) {
        if (loading) return;
        const editor = getEditor();
        if (!editor) return;
        editor.action(replaceAll(md));
      },
      getView() {
        if (loading) return null;
        const editor = getEditor();
        if (!editor) return null;
        try {
          return editor.action((ctx) => ctx.get(editorViewCtx));
        } catch {
          return null;
        }
      },
    }),
    [loading, getEditor],
  );

  return <Milkdown />;
});

export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const selectedProject = useProjectStore((s) => s.selectedProject);
    const currentSession = useSessionStore((s) => s.currentSession);
    const project = selectedProject ?? undefined;
    const session = currentSession?.name ?? undefined;
    const ctxValue = useMemo(() => ({ project, session }), [project, session]);

    // Latest-refs for callbacks so the autosave plugin always sees current props
    // without being recreated on every change.
    const onChangeRef = useRef<((md: string) => void) | undefined | null>(props.onChange);
    const onPersistRef = useRef<((md: string) => void) | null>(props.onPersist);
    // editable is read on every PM transaction via view.props.editable, so the
    // ref lets us flip edit/review mode without recreating the editor.
    const editableRef = useRef<boolean>(props.editable ?? true);
    useLayoutEffect(() => {
      onChangeRef.current = props.onChange;
    });
    useLayoutEffect(() => {
      const original = props.onPersist;
      onPersistRef.current = (md: string) => {
        const start = nowMs();
        try {
          original(md);
        } finally {
          emitTelemetry({
            editor_variant: 'wysiwyg',
            autosave_latency_ms: nowMs() - start,
            timestamp: Date.now(),
          });
        }
      };
    });
    useEffect(() => {
      const next = props.editable ?? true;
      const prev = editableRef.current;
      editableRef.current = next;
      if (prev !== next) {
        // PM reads editable() lazily, but the contenteditable DOM attr only
        // refreshes on a view update — nudge it so the flip is visible.
        // Defer to a microtask to avoid flushSync-inside-render warnings.
        queueMicrotask(() => {
          const view = innerHandleRef.current?.getView();
          if (view) view.setProps({});
        });
      }
    });

    // Annotation ref: read by the PM plugin each time it recomputes.
    const annotationsRef = useRef<Annotation[]>(props.annotations ?? []);
    useLayoutEffect(() => {
      annotationsRef.current = props.annotations ?? [];
    });

    // onReady ref so the inner component can call the latest handler without
    // recreating the editor when the consumer's callback identity changes.
    const onReadyRef = useRef(props.onReady);
    useLayoutEffect(() => {
      onReadyRef.current = props.onReady;
    });

    // Imperative handle forwarding — we want to both forward the inner
    // MilkdownEditorHandle AND dispatch 'setAnnotations' when props.annotations
    // reference changes. Bridge the forwarded ref through our own local ref.
    const innerHandleRef = useRef<MilkdownEditorHandle | null>(null);
    const setRefs = useCallback(
      (h: MilkdownEditorHandle | null) => {
        innerHandleRef.current = h;
        if (typeof ref === 'function') ref(h);
        else if (ref) (ref as MutableRefObject<MilkdownEditorHandle | null>).current = h;
      },
      [ref],
    );
    // Dispatch the latest annotations into the PM plugin. If the view isn't
    // ready yet (editor still mounting), the annotationsRef already tracks the
    // up-to-date list and the PM plugin reads it via getAnnotations() on both
    // init and subsequent docChanged rebuilds, so no update is lost.
    useEffect(() => {
      const view = innerHandleRef.current?.getView();
      if (!view) return;
      view.dispatch(setAnnotationsMeta(view.state.tr, props.annotations ?? []));
    }, [props.annotations]);

    return (
      <MilkdownProvider>
        <ProsemirrorAdapterProvider>
          <ProjectSessionContext.Provider value={ctxValue}>
            <div ref={hostRef} className="milkdown-host">
              <MilkdownInner
                ref={setRefs}
                {...props}
                hostRef={hostRef}
                onChangeRef={onChangeRef}
                onPersistRef={onPersistRef}
                editableRef={editableRef}
                annotationsRef={annotationsRef}
                onReadyRef={onReadyRef}
              />
            </div>
          </ProjectSessionContext.Provider>
        </ProsemirrorAdapterProvider>
      </MilkdownProvider>
    );
  },
);

export default MilkdownEditor;
