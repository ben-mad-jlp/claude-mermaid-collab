import { useEffect, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor,
} from 'lexical';

import { ComposerAttachmentNode } from '@/components/agent-chat/ComposerAttachmentNode';
import { MentionNode } from './ComposerMentionNode';
import { SkillNode } from './ComposerSkillNode';
import { TerminalContextNode } from './ComposerTerminalContextNode';
import { createComposerKeymap } from './composer-editor-keymap';
import { createPasteHandler } from './composer-editor-paste';
import {
  serializeEditorState,
  type ComposerSerialized,
} from './composer-editor-serialize';
import { detectSlashTrigger } from './composer-logic';

export interface ComposerPromptEditorProps {
  initialEditorStateJson?: string;
  placeholder?: string;
  onChange?: (serialized: ComposerSerialized) => void;
  onSubmit?: (serialized: ComposerSerialized) => void;
  onSlashTrigger?: (query: string, anchorRect: DOMRect | null) => void;
  onMentionTrigger?: (query: string, anchorRect: DOMRect | null) => void;
  onEditorReady?: (editor: LexicalEditor) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  sessionId?: string;
}

interface EditorReadyPluginProps {
  onReady?: (editor: LexicalEditor) => void;
}

function EditorReadyPlugin({ onReady }: EditorReadyPluginProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (onReady) onReady(editor);
  }, [editor, onReady]);
  return null;
}

const THEME = {
  paragraph: 'cmc-composer-paragraph',
};

interface KeymapPluginProps {
  onSubmit?: (serialized: ComposerSerialized) => void;
  onCancel?: () => void;
  onMenuOpen?: (trigger: '/' | '@') => void;
}

function KeymapPlugin({ onSubmit, onCancel, onMenuOpen }: KeymapPluginProps) {
  const [editor] = useLexicalComposerContext();
  const submitRef = useRef(onSubmit);
  const cancelRef = useRef(onCancel);
  const menuRef = useRef(onMenuOpen);

  useEffect(() => {
    submitRef.current = onSubmit;
    cancelRef.current = onCancel;
    menuRef.current = onMenuOpen;
  }, [onSubmit, onCancel, onMenuOpen]);

  useEffect(() => {
    const keymap = createComposerKeymap({
      onSubmit: () => {
        const fn = submitRef.current;
        if (!fn) return;
        editor.read(() => {
          fn(serializeEditorState(editor.getEditorState()));
        });
      },
      onCancel: () => {
        cancelRef.current?.();
      },
      onMenuOpen: (trigger) => {
        menuRef.current?.(trigger);
      },
    });
    return keymap.register(editor);
  }, [editor]);

  return null;
}

interface PastePluginProps {
  sessionId?: string;
}

function PastePlugin({ sessionId }: PastePluginProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const handler = createPasteHandler({ sessionId });
    return handler.register(editor);
  }, [editor, sessionId]);
  return null;
}

interface TriggerPluginProps {
  onSlash?: (query: string, anchorRect: DOMRect | null) => void;
  onMention?: (query: string, anchorRect: DOMRect | null) => void;
}

function getAnchorRect(): DOMRect | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return null;
  try {
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width !== 0 || rect.height !== 0 || rect.top !== 0)) {
      return rect;
    }
    // Fallback to the focused element's rect.
    const node = range.startContainer;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    return el ? el.getBoundingClientRect() : null;
  } catch {
    return null;
  }
}

function TriggerPlugin({ onSlash, onMention }: TriggerPluginProps) {
  const [editor] = useLexicalComposerContext();
  const slashRef = useRef(onSlash);
  const mentionRef = useRef(onMention);

  useEffect(() => {
    slashRef.current = onSlash;
    mentionRef.current = onMention;
  }, [onSlash, onMention]);

  useEffect(() => {
    const check = () => {
      editor.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const text = $getRoot().getTextContent();
        // Compute caret offset within the full text via a linear walk.
        // Use selection anchor's absolute offset: textual position up to anchor.
        const anchorNode = selection.anchor.getNode();
        const anchorOffset = selection.anchor.offset;

        // Walk root children to determine caret's absolute text offset.
        let caret = 0;
        let found = false;
        const walk = (nodes: ReturnType<typeof $getRoot>['getChildren']) => {
          // no-op; real walk below
          return nodes;
        };
        void walk;

        // Simpler: use getTextContent up to anchor by concatenation.
        const root = $getRoot();
        const rootChildren = root.getChildren();
        outer: for (let i = 0; i < rootChildren.length; i++) {
          if (i > 0) caret += 1; // newline separator between blocks
          const child = rootChildren[i];
          const stack: Array<typeof child> = [child];
          while (stack.length) {
            const n = stack.shift()!;
            if (n.getKey() === anchorNode.getKey()) {
              caret += anchorOffset;
              found = true;
              break outer;
            }
            const content = n.getTextContent();
            if ('getChildren' in n && typeof (n as any).getChildren === 'function') {
              const kids = (n as any).getChildren();
              if (kids && kids.length) {
                stack.unshift(...kids);
                continue;
              }
            }
            caret += content.length;
          }
        }
        if (!found) return;

        const slash = detectSlashTrigger(text, caret);
        if (slash && slashRef.current) {
          slashRef.current(slash.query, getAnchorRect());
        }

        // Mention trigger: @ followed by path-ish chars up to caret.
        const before = text.slice(0, caret);
        const mentionMatch = /(^|\s)@([A-Za-z0-9_./:\-]*)$/.exec(before);
        if (mentionMatch && mentionRef.current) {
          mentionRef.current(mentionMatch[2], getAnchorRect());
        }
      });
    };

    const unregister = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        check();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUpdate = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) check();
    });

    return () => {
      unregister();
      unregisterUpdate();
    };
  }, [editor]);

  return null;
}

interface DisabledPluginProps {
  disabled: boolean;
}

function DisabledPlugin({ disabled }: DisabledPluginProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

export function ComposerPromptEditor({
  initialEditorStateJson,
  placeholder = 'Type a message...',
  onChange,
  onSubmit,
  onSlashTrigger,
  onMentionTrigger,
  onEditorReady,
  disabled = false,
  autoFocus = false,
  sessionId,
}: ComposerPromptEditorProps) {
  const initialConfig = {
    namespace: 'cmc-composer',
    nodes: [MentionNode, SkillNode, TerminalContextNode, ComposerAttachmentNode],
    theme: THEME,
    editable: !disabled,
    editorState: initialEditorStateJson
      ? (editor: LexicalEditor) =>
          editor.setEditorState(editor.parseEditorState(initialEditorStateJson))
      : undefined,
    onError: (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('[composer]', err);
    },
  };

  const handleChange = (state: EditorState) => {
    if (onChange) onChange(serializeEditorState(state));
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative w-full bg-background text-foreground">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
              aria-label="Message composer"
            />
          }
          placeholder={
            <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
              {placeholder}
            </span>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin onChange={handleChange} />
        <KeymapPlugin
          onSubmit={onSubmit}
          onCancel={() => {
            /* caller-driven cancellation handled via parent */
          }}
          onMenuOpen={(trigger) => {
            // Immediate menu-open signal; TriggerPlugin provides richer queries.
            if (trigger === '/' && onSlashTrigger) onSlashTrigger('', null);
            if (trigger === '@' && onMentionTrigger) onMentionTrigger('', null);
          }}
        />
        <PastePlugin sessionId={sessionId} />
        <TriggerPlugin onSlash={onSlashTrigger} onMention={onMentionTrigger} />
        <DisabledPlugin disabled={disabled} />
        <EditorReadyPlugin onReady={onEditorReady} />
        {autoFocus ? <AutoFocusPlugin /> : null}
      </div>
    </LexicalComposer>
  );
}

export default ComposerPromptEditor;
