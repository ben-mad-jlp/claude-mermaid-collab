import React from 'react';
import { $view } from '@milkdown/utils';
import { imageSchema } from '@milkdown/preset-commonmark';
import { useNodeViewContext, useNodeViewFactory } from '@prosemirror-adapter/react';

type NodeViewFactory = ReturnType<typeof useNodeViewFactory>;

import { resolveImageSrc } from '../../../../lib/resolveImageSrc';
import { useProjectSession } from '../MilkdownEditor';

export function ImageResolverView(): React.ReactElement {
  const { node } = useNodeViewContext();
  const { project, session } = useProjectSession();

  const src: string = node.attrs.src ?? '';
  const alt: string = node.attrs.alt ?? '';
  const title: string | undefined = node.attrs.title ?? undefined;

  let resolvedSrc = src;
  try {
    resolvedSrc = resolveImageSrc(src, { project, session });
  } catch {
    resolvedSrc = src;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      title={title}
      loading="lazy"
      className="max-w-full h-auto my-4 rounded-lg border"
    />
  );
}

export function imageResolverView(nodeViewFactory: NodeViewFactory) {
  return $view(imageSchema.node, () =>
    nodeViewFactory({ component: ImageResolverView }),
  );
}

export default imageResolverView;
