import {
  $getSelection,
  $isRangeSelection,
  $isDecoratorNode,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';
import { $createMentionNode, type MentionPayload } from './ComposerMentionNode';
import { $createSkillNode } from './ComposerSkillNode';

/** The `@query` trigger the picker matches on, anchored at the caret. Kept in
 *  sync with ComposerPromptEditor's mention-trigger regex. */
const MENTION_TRIGGER_RE = /@[A-Za-z0-9_./:\-]*$/;

/**
 * Insert a MentionNode at the current selection, FIRST removing the `@query`
 * trigger text the user typed. Without this the literal `@fo` is left in the
 * paragraph, the trigger regex re-matches on the next update and re-opens the
 * picker, and the stray text ships in the message. Must be called inside an
 * editor.update() context OR will wrap one itself.
 */
export function insertMention(
  editor: LexicalEditor,
  payload: MentionPayload,
): void {
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // Delete the `@query` trigger immediately before a collapsed caret.
      const anchor = selection.anchor;
      if (selection.isCollapsed() && anchor.type === 'text') {
        const textNode = anchor.getNode();
        if ($isTextNode(textNode)) {
          const before = textNode.getTextContent().slice(0, anchor.offset);
          const m = before.match(MENTION_TRIGGER_RE);
          if (m) {
            // moveSelection=true → caret collapses to the deletion start, where
            // the mention node is then inserted.
            textNode.spliceText(anchor.offset - m[0].length, m[0].length, '', true);
          }
        }
      }
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        sel.insertNodes([$createMentionNode(payload)]);
        // Trailing space so the mention is separated and the trigger can't re-fire.
        sel.insertText(' ');
      }
    },
    { discrete: true },
  );
}

/**
 * Insert a SkillNode at the current selection.
 */
export function insertSkill(editor: LexicalEditor, command: string): void {
  editor.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const node = $createSkillNode({ command });
        selection.insertNodes([node]);
      }
    },
    { discrete: true },
  );
}

/**
 * On backspace, if the cursor is adjacent to an inline DecoratorNode, remove
 * it and return true (caller should skip default behavior). Returns false
 * when nothing was removed.
 */
export function removeDecoratorAtCursor(editor: LexicalEditor): boolean {
  let removed = false;
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (!selection.isCollapsed()) return;

      const anchor = selection.anchor;
      const node = anchor.getNode();

      // Element-type anchor (cursor parked in an element, offset = child index).
      if (anchor.type === 'element') {
        const children = 'getChildren' in node ? (node as any).getChildren() : [];
        const idx = anchor.offset;
        const candidate = idx > 0 ? children[idx - 1] : null;
        if (candidate && $isDecoratorNode(candidate) && candidate.isInline()) {
          candidate.remove();
          removed = true;
          return;
        }
      }

      // Check previous sibling — the typical case after a decorator insertion.
      const prev = node.getPreviousSibling();
      if (prev && $isDecoratorNode(prev) && prev.isInline()) {
        prev.remove();
        removed = true;
        return;
      }
      // If selection anchor IS on a decorator node.
      if ($isDecoratorNode(node) && node.isInline()) {
        node.remove();
        removed = true;
        return;
      }
      // If anchor is at offset 0 of a text node, check parent's previous.
      if (anchor.offset === 0) {
        const parentPrev = node.getParent()?.getPreviousSibling();
        if (parentPrev && $isDecoratorNode(parentPrev) && parentPrev.isInline()) {
          parentPrev.remove();
          removed = true;
        }
      }
    },
    { discrete: true },
  );
  return removed;
}
