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

export type SkillPayload = {
  command: string;
};

export type SerializedSkillNode = Spread<
  {
    command: string;
  },
  SerializedLexicalNode
>;

export class SkillNode extends DecoratorNode<JSX.Element> {
  __type = 'composer-skill';
  __command: string;

  static getType(): string {
    return 'composer-skill';
  }

  static clone(node: SkillNode): SkillNode {
    return new SkillNode({ command: node.__command }, node.__key);
  }

  constructor(payload: SkillPayload, key?: NodeKey) {
    super(key);
    this.__command = payload.command;
  }

  static importJSON(serialized: SerializedSkillNode): SkillNode {
    return $createSkillNode({ command: serialized.command });
  }

  exportJSON(): SerializedSkillNode {
    return {
      type: 'composer-skill',
      version: 1,
      command: this.__command,
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

  getPayload(): SkillPayload {
    return { command: this.__command };
  }

  decorate(): JSX.Element {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)] text-xs font-mono">
        /{this.__command}
      </span>
    );
  }
}

export function $createSkillNode(payload: SkillPayload): SkillNode {
  return $applyNodeReplacement(new SkillNode(payload));
}

export function $isSkillNode(node: LexicalNode | null | undefined): node is SkillNode {
  return node instanceof SkillNode;
}
