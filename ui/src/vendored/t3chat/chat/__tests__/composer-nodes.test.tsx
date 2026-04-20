import { describe, it, expect } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode } from 'lexical';
import {
  MentionNode,
  $createMentionNode,
  $isMentionNode,
} from '../ComposerMentionNode';
import {
  SkillNode,
  $createSkillNode,
  $isSkillNode,
} from '../ComposerSkillNode';
import {
  TerminalContextNode,
  $createTerminalContextNode,
  $isTerminalContextNode,
} from '../ComposerTerminalContextNode';

function makeEditor(nodes: any[]) {
  return createEditor({
    namespace: 'test',
    onError: (e) => {
      throw e;
    },
    nodes,
  });
}

describe('ComposerMentionNode', () => {
  it('getType returns composer-mention', () => {
    expect(MentionNode.getType()).toBe('composer-mention');
  });

  it('exportJSON/importJSON round-trip preserves payload', () => {
    const editor = makeEditor([MentionNode]);
    let json: any;
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const node = $createMentionNode({ path: '/a/b.ts', display: 'b.ts' });
        p.append(node);
        root.append(p);
        json = node.exportJSON();
      },
      { discrete: true },
    );
    expect(json.path).toBe('/a/b.ts');
    expect(json.display).toBe('b.ts');
    expect(json.type).toBe('composer-mention');

    editor.update(
      () => {
        const imported = MentionNode.importJSON(json);
        expect($isMentionNode(imported)).toBe(true);
        expect(imported.getPayload()).toEqual({ path: '/a/b.ts', display: 'b.ts' });
      },
      { discrete: true },
    );
  });

  it('clone preserves payload', () => {
    const editor = makeEditor([MentionNode]);
    editor.update(
      () => {
        const n = $createMentionNode({ path: '/x', display: 'x' });
        const c = MentionNode.clone(n);
        expect(c.getPayload()).toEqual({ path: '/x', display: 'x' });
      },
      { discrete: true },
    );
  });
});

describe('ComposerSkillNode', () => {
  it('getType returns composer-skill', () => {
    expect(SkillNode.getType()).toBe('composer-skill');
  });

  it('exportJSON/importJSON round-trip preserves payload', () => {
    const editor = makeEditor([SkillNode]);
    let json: any;
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const node = $createSkillNode({ command: 'summarize' });
        p.append(node);
        root.append(p);
        json = node.exportJSON();
      },
      { discrete: true },
    );
    expect(json.command).toBe('summarize');
    expect(json.type).toBe('composer-skill');

    editor.update(
      () => {
        const imported = SkillNode.importJSON(json);
        expect($isSkillNode(imported)).toBe(true);
        expect(imported.getPayload()).toEqual({ command: 'summarize' });
      },
      { discrete: true },
    );
  });

  it('clone preserves payload', () => {
    const editor = makeEditor([SkillNode]);
    editor.update(
      () => {
        const n = $createSkillNode({ command: 'foo' });
        const c = SkillNode.clone(n);
        expect(c.getPayload()).toEqual({ command: 'foo' });
      },
      { discrete: true },
    );
  });
});

describe('ComposerTerminalContextNode', () => {
  it('getType returns composer-terminal-context', () => {
    expect(TerminalContextNode.getType()).toBe('composer-terminal-context');
  });

  it('exportJSON/importJSON round-trip preserves payload', () => {
    const editor = makeEditor([TerminalContextNode]);
    let json: any;
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const node = $createTerminalContextNode({ sessionId: 's1', label: 'term-1' });
        p.append(node);
        root.append(p);
        json = node.exportJSON();
      },
      { discrete: true },
    );
    expect(json.sessionId).toBe('s1');
    expect(json.label).toBe('term-1');
    expect(json.type).toBe('composer-terminal-context');

    editor.update(
      () => {
        const imported = TerminalContextNode.importJSON(json);
        expect($isTerminalContextNode(imported)).toBe(true);
        expect(imported.getPayload()).toEqual({ sessionId: 's1', label: 'term-1' });
      },
      { discrete: true },
    );
  });

  it('clone preserves payload', () => {
    const editor = makeEditor([TerminalContextNode]);
    editor.update(
      () => {
        const n = $createTerminalContextNode({ sessionId: 's', label: 'L' });
        const c = TerminalContextNode.clone(n);
        expect(c.getPayload()).toEqual({ sessionId: 's', label: 'L' });
      },
      { discrete: true },
    );
  });
});
