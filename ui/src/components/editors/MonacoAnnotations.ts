import type * as Monaco from 'monaco-editor';
import type { SnippetAnnotation } from '@/types/snippet';

export interface AnnotationCallbacks {
  onSave: (original: SnippetAnnotation, newText: string) => void;
  onDelete: (ann: SnippetAnnotation) => void;
}

interface AppliedAnnotations {
  decorationIds: string[];
  disposables: Monaco.IDisposable[];
  contentWidgets: Monaco.editor.IContentWidget[];
}

function buildAnnotationContentWidget(
  ann: SnippetAnnotation,
  editor: Monaco.editor.IStandaloneCodeEditor,
  callbacks: AnnotationCallbacks,
  onClose: () => void,
): Monaco.editor.IContentWidget {
  const domNode = document.createElement('div');
  domNode.className = 'mc-annotation-widget';

  const icon = document.createElement('span');
  icon.className = 'mc-annotation-icon';
  icon.textContent = '💬';
  domNode.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'mc-annotation-text';
  text.textContent = ann.text;
  domNode.appendChild(text);

  const lines = document.createElement('span');
  lines.className = 'mc-annotation-lines';
  lines.textContent = ann.startLine === ann.endLine
    ? `L${ann.startLine}`
    : `L${ann.startLine}–${ann.endLine}`;
  domNode.appendChild(lines);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mc-annotation-btn mc-annotation-btn-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  domNode.appendChild(closeBtn);

  domNode.addEventListener('click', (e) => {
    e.stopPropagation();
    if (domNode.classList.contains('editing')) return;
    domNode.classList.add('editing');

    const textarea = document.createElement('textarea');
    textarea.className = 'mc-annotation-textarea';
    textarea.value = ann.text;
    textarea.rows = Math.max(1, ann.text.split('\n').length);
    text.replaceWith(textarea);
    lines.remove();

    const actions = document.createElement('div');
    actions.className = 'mc-annotation-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mc-annotation-btn mc-annotation-btn-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      callbacks.onDelete(ann);
      onClose();
    });
    actions.appendChild(deleteBtn);
    domNode.appendChild(actions);
    textarea.focus();

    const saveAndExit = () => {
      const newText = textarea.value.trim();
      if (newText && newText !== ann.text) {
        callbacks.onSave(ann, newText);
      }
      onClose();
    };

    let cancelled = false;

    textarea.addEventListener('blur', () => setTimeout(() => {
      if (!cancelled && document.activeElement !== textarea) saveAndExit();
    }, 150));

    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); textarea.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); cancelled = true; onClose(); }
      ev.stopPropagation();
    });
  });

  const widgetId = `mc-annotation-${ann.startLine}-${Date.now()}`;

  return {
    getId: () => widgetId,
    getDomNode: () => domNode,
    getPosition: () => ({
      position: { lineNumber: ann.startLine, column: 1 },
      preference: [2 /* ContentWidgetPositionPreference.BELOW */],
    }),
  };
}

export function applyAnnotations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monacoInstance: typeof Monaco,
  annotations: SnippetAnnotation[],
  callbacks: AnnotationCallbacks,
): AppliedAnnotations {
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  const disposables: Monaco.IDisposable[] = [];
  const contentWidgets: Monaco.editor.IContentWidget[] = [];
  const activeWidgets = new Map<number, Monaco.editor.IContentWidget>();

  const sorted = [...annotations].sort((a, b) => a.startLine - b.startLine);

  for (const ann of sorted) {
    decorations.push({
      range: new monacoInstance.Range(ann.startLine, 1, ann.endLine, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: 'mc-annotation-glyph',
        glyphMarginHoverMessage: { value: ann.text },
      },
    });
  }

  const decorationIds = editor.deltaDecorations([], decorations);

  const GLYPH_MARGIN = monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;

  const mouseDisposable = editor.onMouseDown((e) => {
    const targetType = e.target.type;
    if (targetType !== GLYPH_MARGIN) return;
    const lineNumber = e.target.position?.lineNumber;
    if (!lineNumber) return;

    const ann = sorted.find((a) => a.startLine === lineNumber);
    if (!ann) return;

    if (activeWidgets.has(ann.startLine)) {
      const existing = activeWidgets.get(ann.startLine)!;
      editor.removeContentWidget(existing);
      activeWidgets.delete(ann.startLine);
      return;
    }

    const onClose = () => {
      const w = activeWidgets.get(ann.startLine);
      if (w) { editor.removeContentWidget(w); activeWidgets.delete(ann.startLine); }
    };

    const widget = buildAnnotationContentWidget(ann, editor, callbacks, onClose);
    editor.addContentWidget(widget);
    contentWidgets.push(widget);
    activeWidgets.set(ann.startLine, widget);
  });

  disposables.push(mouseDisposable);

  injectAnnotationStyles();

  return { decorationIds, disposables, contentWidgets };
}

export function clearAnnotations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  prev: AppliedAnnotations,
): void {
  for (const d of prev.disposables) d.dispose();
  for (const w of prev.contentWidgets) {
    try { editor.removeContentWidget(w); } catch { /* already removed */ }
  }
  editor.deltaDecorations(prev.decorationIds, []);
}

export function injectAnnotationStyles(): void {
  const styleId = 'mc-annotation-styles';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .mc-annotation-glyph { cursor: pointer; }
    .mc-annotation-glyph::before { content: '💬'; font-size: 12px; }
    .mc-annotation-widget {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 4px 8px 4px 12px; margin: 2px 0;
      border-left: 3px solid #f59e0b;
      background-color: rgba(245, 158, 11, 0.06);
      font-size: 12px; line-height: 1.4; color: #92400e;
      cursor: pointer; border-radius: 0 4px 4px 0;
      min-width: 200px; max-width: 400px; z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .mc-annotation-icon { flex-shrink: 0; font-size: 13px; line-height: 1.4; }
    .mc-annotation-text { white-space: pre-wrap; word-break: break-word; flex: 1; min-width: 0; }
    .mc-annotation-lines { flex-shrink: 0; font-size: 10px; opacity: 0.6; margin-left: auto; padding-left: 8px; }
    .mc-annotation-btn-close { background: none; border: none; cursor: pointer; font-size: 14px; color: #9ca3af; padding: 0 2px; }
    .mc-annotation-textarea {
      flex: 1; min-width: 0; border: 1px solid #d4d4d4; border-radius: 3px;
      padding: 3px 6px; font-size: 12px; line-height: 1.4; font-family: inherit;
      resize: vertical; min-height: 24px; background-color: white; color: #1f2937; outline: none;
    }
    .mc-annotation-actions { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
    .mc-annotation-btn { padding: 2px 8px; font-size: 11px; border-radius: 3px; border: none; cursor: pointer; font-weight: 500; line-height: 1.4; }
    .mc-annotation-btn-delete { background-color: transparent; color: #ef4444; padding: 2px 4px; }
  `;
  document.head.appendChild(style);
}
