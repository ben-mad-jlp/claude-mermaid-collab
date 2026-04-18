/**
 * ProseMirror plugin that renders annotation highlights as inline decorations.
 *
 * State holds the current annotations array plus a DecorationSet derived from
 * them. Decorations are recomputed whenever the doc changes or the annotation
 * list is swapped via the 'setAnnotations' meta.
 */

import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Transaction, EditorState } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/prose/model';
import type { Annotation } from './schema';
import { resolveAnchor } from './anchor';

export interface AnnotationsPluginState {
  annotations: Annotation[];
  decorations: DecorationSet;
}

export const annotationsPluginKey = new PluginKey<AnnotationsPluginState>('annotations');

const SET_ANNOTATIONS_META = 'setAnnotations';

export function setAnnotationsMeta(tr: Transaction, annotations: Annotation[]): Transaction {
  return tr.setMeta(SET_ANNOTATIONS_META, annotations);
}

function buildDecorations(doc: ProseMirrorNode, annotations: Annotation[]): DecorationSet {
  const decos: Decoration[] = [];
  for (const ann of annotations) {
    const resolved = resolveAnchor(doc, ann.anchor);
    if (!resolved) continue;
    if (resolved.from === resolved.to) continue;
    decos.push(
      Decoration.inline(resolved.from, resolved.to, {
        class: `annotation annotation-${ann.kind}`,
        'data-annotation-id': ann.id,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

export function createAnnotationsPlugin(
  getAnnotations: () => Annotation[],
): Plugin<AnnotationsPluginState> {
  return new Plugin<AnnotationsPluginState>({
    key: annotationsPluginKey,
    state: {
      init(_config, state) {
        const annotations = getAnnotations();
        return {
          annotations,
          decorations: buildDecorations(state.doc, annotations),
        };
      },
      apply(tr, value, _oldState, newState) {
        const metaAnnotations = tr.getMeta(SET_ANNOTATIONS_META) as Annotation[] | undefined;
        if (metaAnnotations !== undefined) {
          return {
            annotations: metaAnnotations,
            decorations: buildDecorations(newState.doc, metaAnnotations),
          };
        }
        if (tr.docChanged) {
          // Re-read the latest annotations from the host ref so updates that
          // arrived before the view mounted (and therefore couldn't be
          // dispatched via meta) are not lost.
          const annotations = getAnnotations();
          return {
            annotations,
            decorations: buildDecorations(newState.doc, annotations),
          };
        }
        return value;
      },
    },
    props: {
      decorations(state: EditorState) {
        return annotationsPluginKey.getState(state)?.decorations;
      },
    },
  });
}
