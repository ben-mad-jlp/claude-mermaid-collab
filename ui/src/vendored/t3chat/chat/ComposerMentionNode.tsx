import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { JSX } from 'react';

export type MentionPayload = {
  path: string;
  display: string;
};

export type SerializedMentionNode = Spread<
  {
    path: string;
    display: string;
  },
  SerializedLexicalNode
>;

export class MentionNode extends DecoratorNode<JSX.Element> {
  __type = 'composer-mention';
  __path: string;
  __display: string;

  static getType(): string {
    return 'composer-mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode({ path: node.__path, display: node.__display }, node.__key);
  }

  constructor(payload: MentionPayload, key?: NodeKey) {
    super(key);
    this.__path = payload.path;
    this.__display = payload.display;
  }

  static importJSON(serialized: SerializedMentionNode): MentionNode {
    return $createMentionNode({ path: serialized.path, display: serialized.display });
  }

  exportJSON(): SerializedMentionNode {
    return {
      type: 'composer-mention',
      version: 1,
      path: this.__path,
      display: this.__display,
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

  getPayload(): MentionPayload {
    return { path: this.__path, display: this.__display };
  }

  decorate(): JSX.Element {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-foreground)] text-xs font-mono">
        @{this.__display}
      </span>
    );
  }
}

export function $createMentionNode(payload: MentionPayload): MentionNode {
  return $applyNodeReplacement(new MentionNode(payload));
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}
