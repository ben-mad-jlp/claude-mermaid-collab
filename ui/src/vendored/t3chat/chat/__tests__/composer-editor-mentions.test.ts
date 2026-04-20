import { describe, it, expect } from 'vitest';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
} from 'lexical';
import { MentionNode, $isMentionNode } from '../ComposerMentionNode';
import { SkillNode } from '../ComposerSkillNode';
import { TerminalContextNode } from '../ComposerTerminalContextNode';
import {
  insertMention,
  insertSkill,
  removeDecoratorAtCursor,
} from '../composer-editor-mentions';

function makeEditor() {
  return createEditor({
    namespace: 'test',
    onError: (e) => {
      throw e;
    },
    nodes: [MentionNode, SkillNode, TerminalContextNode],
  });
}

describe('composer-editor-mentions', () => {
  it('insertMention + removeDecoratorAtCursor round-trips', () => {
    const editor = makeEditor();

    // Seed: empty paragraph with collapsed selection at end.
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        p.select();
      },
      { discrete: true },
    );

    insertMention(editor, { path: '/x/y.ts', display: 'y.ts' });

    let found = false;
    editor.getEditorState().read(() => {
      const mentions = $getRoot()
        .getAllTextNodes()
        .concat(); // noop — just exercise APIs
      void mentions;
      const first = $getRoot().getFirstChild();
      if (first && 'getChildren' in first) {
        for (const c of (first as any).getChildren()) {
          if ($isMentionNode(c)) {
            found = true;
            expect(c.getPayload().path).toBe('/x/y.ts');
          }
        }
      }
    });
    expect(found).toBe(true);

    // Place cursor right after the decorator (end of paragraph).
    editor.update(
      () => {
        const p = $getRoot().getFirstChild();
        if (p && 'selectEnd' in p) (p as any).selectEnd();
      },
      { discrete: true },
    );

    const removed = removeDecoratorAtCursor(editor);
    expect(removed).toBe(true);

    let remaining = 0;
    editor.getEditorState().read(() => {
      const first = $getRoot().getFirstChild();
      if (first && 'getChildren' in first) {
        for (const c of (first as any).getChildren()) {
          if ($isMentionNode(c)) remaining += 1;
        }
      }
    });
    expect(remaining).toBe(0);
  });

  it('removeDecoratorAtCursor returns false when no adjacent decorator', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        p.select();
      },
      { discrete: true },
    );
    expect(removeDecoratorAtCursor(editor)).toBe(false);
  });

  it('insertSkill inserts a SkillNode', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        root.append(p);
        p.select();
      },
      { discrete: true },
    );
    insertSkill(editor, 'summarize');

    // Confirm selection insertion worked.
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      // Selection API available.
      void $isRangeSelection(sel);
    });

    let foundCmd: string | null = null;
    editor.getEditorState().read(() => {
      const first = $getRoot().getFirstChild();
      if (first && 'getChildren' in first) {
        for (const c of (first as any).getChildren()) {
          if ('getPayload' in c && c.getType?.() === 'composer-skill') {
            foundCmd = (c as any).getPayload().command;
          }
        }
      }
    });
    expect(foundCmd).toBe('summarize');
  });
});
