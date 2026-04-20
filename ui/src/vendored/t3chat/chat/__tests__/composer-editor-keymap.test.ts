import { describe, it, expect, vi } from 'vitest';
import { createEditor } from 'lexical';
import { MentionNode } from '../ComposerMentionNode';
import { SkillNode } from '../ComposerSkillNode';
import { TerminalContextNode } from '../ComposerTerminalContextNode';
import { createComposerKeymap } from '../composer-editor-keymap';

function makeEditor() {
  return createEditor({
    namespace: 'test',
    onError: (e) => {
      throw e;
    },
    nodes: [MentionNode, SkillNode, TerminalContextNode],
  });
}

describe('composer-editor-keymap', () => {
  it('register returns a callable cleanup function', () => {
    const editor = makeEditor();
    const keymap = createComposerKeymap({
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      onMenuOpen: vi.fn(),
    });
    const unregister = keymap.register(editor);
    expect(typeof unregister).toBe('function');
    // Calling cleanup should not throw.
    expect(() => unregister()).not.toThrow();
  });

  it('cleanup is idempotent', () => {
    const editor = makeEditor();
    const keymap = createComposerKeymap({
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      onMenuOpen: vi.fn(),
    });
    const unregister = keymap.register(editor);
    unregister();
    expect(() => unregister()).not.toThrow();
  });
});
