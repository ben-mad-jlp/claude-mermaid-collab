import { describe, it, expect } from 'vitest';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
} from 'lexical';
import { MentionNode, $isMentionNode } from '../ComposerMentionNode';
import { SkillNode, $isSkillNode } from '../ComposerSkillNode';
import { TerminalContextNode } from '../ComposerTerminalContextNode';
import {
  createPasteHandler,
  parsePastedText,
} from '../composer-editor-paste';

function makeEditor() {
  return createEditor({
    namespace: 'test',
    onError: (e) => {
      throw e;
    },
    nodes: [MentionNode, SkillNode, TerminalContextNode],
  });
}

function setupEmpty(editor: ReturnType<typeof makeEditor>) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      root.append(p);
      p.select();
    },
    { discrete: true },
  );
}

describe('composer-editor-paste', () => {
  it('parsePastedText converts @file/path into a MentionNode', () => {
    const editor = makeEditor();
    setupEmpty(editor);

    let count = 0;
    editor.update(
      () => {
        const nodes = parsePastedText('see @foo/bar.ts for details');
        for (const n of nodes) {
          if ($isMentionNode(n)) count += 1;
        }
      },
      { discrete: true },
    );
    expect(count).toBe(1);
  });

  it('pasted text yields MentionNode in editor state', () => {
    const editor = makeEditor();
    setupEmpty(editor);

    const paste = createPasteHandler();
    // Synthesize a ClipboardEvent shape with getData.
    const evt: any = {
      preventDefault: () => {},
      clipboardData: {
        getData: (t: string) => (t === 'text/plain' ? 'hey @foo/bar.ts!' : ''),
      },
    };
    const handled = paste.handler(evt as ClipboardEvent, editor);
    expect(handled).toBe(true);

    let found = false;
    editor.getEditorState().read(() => {
      const walk = (node: any) => {
        if ($isMentionNode(node)) {
          found = true;
          expect(node.getPayload().path).toBe('foo/bar.ts');
          expect(node.getPayload().display).toBe('bar.ts');
        }
        if ('getChildren' in node) {
          for (const c of node.getChildren()) walk(c);
        }
      };
      walk($getRoot());
    });
    expect(found).toBe(true);
  });

  it('leading /cmd becomes a SkillNode', () => {
    const editor = makeEditor();
    setupEmpty(editor);

    let count = 0;
    editor.update(
      () => {
        const nodes = parsePastedText('/summarize please');
        for (const n of nodes) {
          if ($isSkillNode(n)) count += 1;
        }
      },
      { discrete: true },
    );
    expect(count).toBe(1);
  });

  it('register returns an unregister fn', () => {
    const editor = makeEditor();
    const paste = createPasteHandler();
    const off = paste.register(editor);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});
