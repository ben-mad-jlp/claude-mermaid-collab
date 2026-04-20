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

export type TerminalContextPayload = {
  sessionId: string;
  label: string;
};

export type SerializedTerminalContextNode = Spread<
  {
    sessionId: string;
    label: string;
  },
  SerializedLexicalNode
>;

export class TerminalContextNode extends DecoratorNode<JSX.Element> {
  __type = 'composer-terminal-context';
  __sessionId: string;
  __label: string;

  static getType(): string {
    return 'composer-terminal-context';
  }

  static clone(node: TerminalContextNode): TerminalContextNode {
    return new TerminalContextNode(
      { sessionId: node.__sessionId, label: node.__label },
      node.__key,
    );
  }

  constructor(payload: TerminalContextPayload, key?: NodeKey) {
    super(key);
    this.__sessionId = payload.sessionId;
    this.__label = payload.label;
  }

  static importJSON(serialized: SerializedTerminalContextNode): TerminalContextNode {
    return $createTerminalContextNode({
      sessionId: serialized.sessionId,
      label: serialized.label,
    });
  }

  exportJSON(): SerializedTerminalContextNode {
    return {
      type: 'composer-terminal-context',
      version: 1,
      sessionId: this.__sessionId,
      label: this.__label,
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

  getPayload(): TerminalContextPayload {
    return { sessionId: this.__sessionId, label: this.__label };
  }

  decorate(): JSX.Element {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-mono">
        📟 {this.__label}
      </span>
    );
  }
}

export function $createTerminalContextNode(
  payload: TerminalContextPayload,
): TerminalContextNode {
  return $applyNodeReplacement(new TerminalContextNode(payload));
}

export function $isTerminalContextNode(
  node: LexicalNode | null | undefined,
): node is TerminalContextNode {
  return node instanceof TerminalContextNode;
}
