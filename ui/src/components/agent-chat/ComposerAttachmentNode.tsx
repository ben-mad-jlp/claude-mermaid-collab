import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { JSX } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

export type AttachmentPayload = {
  attachmentId: string;
  mimeType: string;
  objectURL: string;
};

export type SerializedAttachmentNode = Spread<
  { attachmentId: string; mimeType: string; objectURL: string },
  SerializedLexicalNode
>;

function AttachmentChip({
  nodeKey,
  objectURL,
  mimeType,
}: {
  nodeKey: NodeKey;
  objectURL: string;
  mimeType: string;
}) {
  const [editor] = useLexicalComposerContext();
  const handleRemove = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  };
  const label = mimeType.split('/').pop() ?? mimeType;
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted px-1 py-0.5 text-xs align-middle">
      <img src={objectURL} alt="" className="h-6 w-6 rounded object-cover" />
      <span className="font-mono text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={handleRemove}
        className="ml-0.5 leading-none text-muted-foreground hover:text-foreground"
        aria-label="Remove attachment"
      >
        ×
      </button>
    </span>
  );
}

export class ComposerAttachmentNode extends DecoratorNode<JSX.Element> {
  __type = 'composer-attachment';
  __attachmentId: string;
  __mimeType: string;
  __objectURL: string;

  static getType(): string {
    return 'composer-attachment';
  }

  static clone(node: ComposerAttachmentNode): ComposerAttachmentNode {
    return new ComposerAttachmentNode(
      { attachmentId: node.__attachmentId, mimeType: node.__mimeType, objectURL: node.__objectURL },
      node.__key,
    );
  }

  constructor(payload: AttachmentPayload, key?: NodeKey) {
    super(key);
    this.__attachmentId = payload.attachmentId;
    this.__mimeType = payload.mimeType;
    this.__objectURL = payload.objectURL;
  }

  static importJSON(s: SerializedAttachmentNode): ComposerAttachmentNode {
    return $createComposerAttachmentNode(s.attachmentId, s.mimeType, s.objectURL);
  }

  exportJSON(): SerializedAttachmentNode {
    return {
      type: 'composer-attachment',
      version: 1,
      attachmentId: this.__attachmentId,
      mimeType: this.__mimeType,
      objectURL: this.__objectURL,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  decorate(): JSX.Element {
    return (
      <AttachmentChip
        nodeKey={this.__key}
        objectURL={this.__objectURL}
        mimeType={this.__mimeType}
      />
    );
  }
}

export function $createComposerAttachmentNode(
  attachmentId: string,
  mimeType: string,
  objectURL: string,
): ComposerAttachmentNode {
  return $applyNodeReplacement(new ComposerAttachmentNode({ attachmentId, mimeType, objectURL }));
}

export function $isComposerAttachmentNode(
  node: LexicalNode | null | undefined,
): node is ComposerAttachmentNode {
  return node instanceof ComposerAttachmentNode;
}
