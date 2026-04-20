import {
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isTextNode,
  type EditorState,
  type LexicalNode,
} from 'lexical';
import { $isMentionNode, type MentionNode } from './ComposerMentionNode';
import { $isSkillNode, type SkillNode } from './ComposerSkillNode';
import {
  $isTerminalContextNode,
  type TerminalContextNode,
} from './ComposerTerminalContextNode';

export interface ComposerMention {
  kind: 'file' | 'skill' | 'terminal';
  value: string;
  range: { from: number; to: number };
  display?: string;
}

export interface ComposerSerialized {
  text: string;
  mentions: ComposerMention[];
  editorStateJson: string;
}

/**
 * Serialize a Lexical EditorState into plain text plus a list of decorator
 * mentions and their character ranges within that text.
 *
 * Text representation for decorators:
 *   - MentionNode        → "@{display}"
 *   - SkillNode          → "/{command}"
 *   - TerminalContextNode → "@{label}"
 */
export function serializeEditorState(state: EditorState): ComposerSerialized {
  const editorStateJson = JSON.stringify(state.toJSON());

  let text = '';
  const mentions: ComposerMention[] = [];

  state.read(() => {
    const root = $getRoot();
    const children = root.getChildren();

    children.forEach((child, idx) => {
      if (idx > 0) text += '\n';
      walk(child);
    });
  });

  function walk(node: LexicalNode) {
    if ($isMentionNode(node)) {
      const n = node as MentionNode;
      const payload = n.getPayload();
      const piece = `@${payload.display}`;
      const from = text.length;
      text += piece;
      mentions.push({
        kind: 'file',
        value: payload.path,
        display: payload.display,
        range: { from, to: text.length },
      });
      return;
    }
    if ($isSkillNode(node)) {
      const n = node as SkillNode;
      const payload = n.getPayload();
      const piece = `/${payload.command}`;
      const from = text.length;
      text += piece;
      mentions.push({
        kind: 'skill',
        value: payload.command,
        range: { from, to: text.length },
      });
      return;
    }
    if ($isTerminalContextNode(node)) {
      const n = node as TerminalContextNode;
      const payload = n.getPayload();
      const piece = `@${payload.label}`;
      const from = text.length;
      text += piece;
      mentions.push({
        kind: 'terminal',
        value: payload.sessionId,
        display: payload.label,
        range: { from, to: text.length },
      });
      return;
    }
    if ($isDecoratorNode(node)) {
      // Unknown decorator — skip, but advance no text.
      return;
    }
    if ($isTextNode(node)) {
      text += node.getTextContent();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
      }
    }
  }

  return { text, mentions, editorStateJson };
}
