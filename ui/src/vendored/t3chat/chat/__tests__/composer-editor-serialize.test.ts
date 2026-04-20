import { describe, it, expect } from 'vitest';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from 'lexical';
import { MentionNode, $createMentionNode } from '../ComposerMentionNode';
import { SkillNode, $createSkillNode } from '../ComposerSkillNode';
import {
  TerminalContextNode,
  $createTerminalContextNode,
} from '../ComposerTerminalContextNode';
import { serializeEditorState } from '../composer-editor-serialize';

function makeEditor() {
  return createEditor({
    namespace: 'test',
    onError: (e) => {
      throw e;
    },
    nodes: [MentionNode, SkillNode, TerminalContextNode],
  });
}

describe('composer-editor-serialize', () => {
  it('empty editor serializes to empty text and []', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      },
      { discrete: true },
    );
    const out = serializeEditorState(editor.getEditorState());
    expect(out.text).toBe('');
    expect(out.mentions).toEqual([]);
    expect(typeof out.editorStateJson).toBe('string');
    // Valid JSON.
    expect(() => JSON.parse(out.editorStateJson)).not.toThrow();
  });

  it('text-only serializes text and leaves mentions empty', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const p = $createParagraphNode();
        p.append($createTextNode('hello world'));
        root.append(p);
      },
      { discrete: true },
    );
    const out = serializeEditorState(editor.getEditorState());
    expect(out.text).toBe('hello world');
    expect(out.mentions).toEqual([]);
    const parsed = JSON.parse(out.editorStateJson);
    expect(parsed).toBeTruthy();
  });

  it('with mentions: computes text, mentions array, and ranges', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const p = $createParagraphNode();
        p.append($createTextNode('see '));
        p.append($createMentionNode({ path: '/a/b.ts', display: 'b.ts' }));
        p.append($createTextNode(' then run '));
        p.append($createSkillNode({ command: 'doit' }));
        p.append($createTextNode(' in '));
        p.append(
          $createTerminalContextNode({ sessionId: 'sess-1', label: 'term-1' }),
        );
        root.append(p);
      },
      { discrete: true },
    );

    const out = serializeEditorState(editor.getEditorState());

    expect(out.text).toBe('see @b.ts then run /doit in @term-1');
    expect(out.mentions).toHaveLength(3);

    expect(out.mentions[0]).toMatchObject({
      kind: 'file',
      value: '/a/b.ts',
      display: 'b.ts',
    });
    expect(out.text.slice(out.mentions[0].range.from, out.mentions[0].range.to)).toBe(
      '@b.ts',
    );

    expect(out.mentions[1]).toMatchObject({ kind: 'skill', value: 'doit' });
    expect(out.text.slice(out.mentions[1].range.from, out.mentions[1].range.to)).toBe(
      '/doit',
    );

    expect(out.mentions[2]).toMatchObject({
      kind: 'terminal',
      value: 'sess-1',
      display: 'term-1',
    });
    expect(out.text.slice(out.mentions[2].range.from, out.mentions[2].range.to)).toBe(
      '@term-1',
    );

    const parsed = JSON.parse(out.editorStateJson);
    expect(parsed).toBeTruthy();
  });
});
