import * as React from 'react';
import { Send, Square, Paperclip } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import {
  searchSlashCommands,
  type SlashSearchResult,
} from './composerSlashCommandSearch';
import { ComposerCommandMenu } from './ComposerCommandMenu';
import { ComposerPendingApprovalPanel } from './ComposerPendingApprovalPanel';
import { ContextWindowMeter } from './ContextWindowMeter';
import { ModeSelector } from './ModeSelector';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import type { ComposerSerialized } from './composer-editor-serialize';
import { insertMention, insertSkill } from './composer-editor-mentions';
import { FileMentionPicker } from '@/components/agent-chat/FileMentionPicker';
import type { LexicalEditor } from 'lexical';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_TAB_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import type { ChatComposerProps } from './ChatComposer';
import { HistorySearchPopover } from '@/components/agent-chat/HistorySearchPopover';
import { ShortcutsDialog } from '@/components/agent-chat/ShortcutsDialog';
import { triggerEditorRoundTrip } from '@/components/agent-chat/EditorRoundTrip';
import { pushHistory, getHistory, type ComposerHistoryEntry } from '@/stores/composerDraftStore';
import { $isComposerAttachmentNode } from '@/components/agent-chat/ComposerAttachmentNode';
import { useNotificationStore } from '@/stores/notificationStore';

// Locally-intercepted slash commands which, when submitted as a single-pill
// skill mention with no surrounding content, route through `onSlashCommand`
// instead of `onSend`.
const LOCAL_INTERCEPT_COMMANDS = new Set([
  'clear',
  'help',
  'model',
  'cost',
  'resume',
  'rename',
]);

interface PickerState {
  query: string;
  anchorRect: DOMRect | null;
}

const LexicalChatComposer: React.FC<ChatComposerProps> = ({
  onSend,
  onSendSerialized,
  onCancel,
  onAttach,
  isStreaming,
  disabled,
  placeholder = 'Message Claude...',
  slashCommands = [],
  onSlashCommand,
  pending = null,
  onApprovalAllow,
  onApprovalAllowAlways,
  onApprovalDeny,
  contextUsed,
  contextTotal,
  runtimeMode,
  interactionMode,
  onRuntimeChange,
  onInteractionChange,
  className,
  sessionId,
}) => {
  const [editor, setEditor] = React.useState<LexicalEditor | null>(null);
  const [mentionState, setMentionState] = React.useState<PickerState | null>(null);
  const historyIdxRef = React.useRef<number>(-1);
  const [showHistorySearch, setShowHistorySearch] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [slashState, setSlashState] = React.useState<PickerState | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = React.useState(0);
  const [lastSerialized, setLastSerialized] =
    React.useState<ComposerSerialized | null>(null);

  const slashResults: SlashSearchResult[] = React.useMemo(
    () => (slashState ? searchSlashCommands(slashCommands, slashState.query) : []),
    [slashState, slashCommands]
  );
  const slashMenuOpen = !!slashState && slashResults.length > 0;

  React.useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashState?.query, slashMenuOpen]);

  const clearEditor = React.useCallback(() => {
    if (!editor) return;
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
      },
      { discrete: true }
    );
  }, [editor]);

  const addToast = useNotificationStore((s) => s.addToast);

  // Phase 2: history navigation + keyboard shortcuts
  React.useEffect(() => {
    if (!editor) return;

    const isAtTopEdge = (): boolean => {
      const root = editor.getRootElement();
      if (!root) return true;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return true;
      const range = sel.getRangeAt(0);
      const selRect = range.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      // At top edge if selection top is within a line-height (24px) of the root top
      return selRect.top - rootRect.top < 24;
    };

    const isAtBottomEdge = (): boolean => {
      const root = editor.getRootElement();
      if (!root) return true;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return true;
      const range = sel.getRangeAt(0);
      const selRect = range.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return rootRect.bottom - selRect.bottom < 24;
    };

    const unregisterUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        if (!isAtTopEdge()) return false;
        const history = getHistory(sessionId ?? '');
        if (!history.length) return false;
        const currentIdx = historyIdxRef.current;
        const nextIdx = currentIdx < history.length - 1 ? currentIdx + 1 : currentIdx;
        if (nextIdx === currentIdx) return false;
        const entry = history[nextIdx];
        try {
          editor.setEditorState(editor.parseEditorState(entry.editorStateJson));
        } catch {
          editor.update(() => { $getRoot().clear(); });
        }
        historyIdxRef.current = nextIdx;
        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    const unregisterDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        if (!isAtBottomEdge()) return false;
        const currentIdx = historyIdxRef.current;
        if (currentIdx <= 0) {
          if (currentIdx === 0) {
            historyIdxRef.current = -1;
            editor.update(() => { $getRoot().clear(); });
          }
          return false;
        }
        const history = getHistory(sessionId ?? '');
        const nextIdx = currentIdx - 1;
        const entry = history[nextIdx];
        try {
          editor.setEditorState(editor.parseEditorState(entry.editorStateJson));
        } catch {
          editor.update(() => { $getRoot().clear(); });
        }
        historyIdxRef.current = nextIdx;
        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      () => false,
      COMMAND_PRIORITY_LOW
    );

    let lastEscTime = 0;
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        setShowHistorySearch(true);
      } else if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        triggerEditorRoundTrip(editor, sessionId ?? '');
      } else if (e.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscTime < 500) {
          addToast({ type: 'warning', title: 'Rewind feature coming soon', duration: 3000 });
          lastEscTime = 0;
        } else {
          lastEscTime = now;
        }
      }
    };

    const rootEl = editor.getRootElement();
    rootEl?.addEventListener('keydown', handleKeydown);

    return () => {
      unregisterUp();
      unregisterDown();
      unregisterTab();
      rootEl?.removeEventListener('keydown', handleKeydown);
    };
  }, [editor, sessionId, addToast]);

  const handleHistorySelect = React.useCallback((entry: ComposerHistoryEntry) => {
    if (!editor) return;
    try {
      editor.setEditorState(editor.parseEditorState(entry.editorStateJson));
    } catch { editor.update(() => { $getRoot().clear(); }); }
    setShowHistorySearch(false);
  }, [editor]);

  const handleMentionTrigger = React.useCallback(
    (query: string, anchorRect: DOMRect | null) => {
      setMentionState({ query, anchorRect });
    },
    []
  );

  const handleSlashTrigger = React.useCallback(
    (query: string, anchorRect: DOMRect | null) => {
      setSlashState({ query, anchorRect });
    },
    []
  );

  const handleMentionSelect = React.useCallback(
    (path: string) => {
      if (editor) {
        const display = path.split('/').pop() ?? path;
        insertMention(editor, { path, display });
      }
      setMentionState(null);
    },
    [editor]
  );

  const applySlash = React.useCallback(
    (i: number) => {
      const cmd = slashResults[i]?.command;
      if (!cmd) return;
      if (editor) insertSkill(editor, cmd.name);
      setSlashState(null);
    },
    [slashResults, editor]
  );

  const handleSubmit = React.useCallback(
    (serialized: ComposerSerialized) => {
      if (disabled || isStreaming) return;

      // Plain-text slash intercept: no mentions, text begins with '/'.
      const { text, mentions } = serialized;
      if (mentions.length === 0 && text.trimStart().startsWith('/')) {
        const trimmed = text.trimStart();
        const match = trimmed.match(/^\/(\S+)(\s+([\s\S]*))?$/);
        if (match) {
          const token = match[1];
          const args = (match[3] ?? '').trim();
          if (LOCAL_INTERCEPT_COMMANDS.has(token) && onSlashCommand) {
            const handled = onSlashCommand(token, args);
            if (handled) {
              clearEditor();
              return;
            }
          }
        }
      }

      // Single-pill intercept: exactly one skill mention with no non-whitespace
      // surrounding text maps to local slash command handling.
      if (mentions.length === 1 && mentions[0].kind === 'skill') {
        const m = mentions[0];
        const before = text.slice(0, m.range.from);
        const after = text.slice(m.range.to);
        if (!before.trim() && !after.trim() && LOCAL_INTERCEPT_COMMANDS.has(m.value)) {
          // No args when the whole message is the pill — pass undefined for clarity (BUG-09).
          if (onSlashCommand) onSlashCommand(m.value, undefined);
          clearEditor();
          return;
        }
      }

      if (!text.trim() && mentions.length === 0) return;

      // Collect attachment nodes before sending
      const collectedAttachments: Array<{ attachmentId: string; mimeType: string }> = [];
      editor?.getEditorState().read(() => {
        const root = $getRoot();
        for (const child of root.getChildren()) {
          if ($isComposerAttachmentNode(child)) {
            collectedAttachments.push({
              attachmentId: (child as any).__attachmentId ?? '',
              mimeType: (child as any).__mimeType ?? 'image/*',
            });
          }
        }
      });

      // Push to history ring
      if (editor) {
        pushHistory(sessionId ?? '', {
          editorStateJson: JSON.stringify(editor.getEditorState().toJSON()),
          plain: text,
          attachments: [],
          ts: Date.now(),
        });
      }
      historyIdxRef.current = -1;

      if (onSendSerialized) {
        onSendSerialized({ ...serialized, attachments: collectedAttachments });
      } else {
        onSend(text);
      }
    },
    [disabled, isStreaming, onSend, onSendSerialized, onSlashCommand, clearEditor, editor, sessionId]
  );

  const hasContent =
    !!lastSerialized &&
    (lastSerialized.text.trim().length > 0 || lastSerialized.mentions.length > 0);

  return (
    <div className={cn('relative flex flex-col gap-2 border-t bg-background p-3', className)}>
      <HistorySearchPopover open={showHistorySearch} onClose={() => setShowHistorySearch(false)} sessionId={sessionId ?? ''} onSelect={handleHistorySelect} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {runtimeMode && interactionMode && onRuntimeChange && onInteractionChange && (
        <div className="flex items-center">
          <ModeSelector
            runtime={runtimeMode}
            interaction={interactionMode}
            onRuntimeChange={onRuntimeChange}
            onInteractionChange={onInteractionChange}
            disabled={disabled}
          />
        </div>
      )}
      {pending && (
        <ComposerPendingApprovalPanel
          pending={pending}
          onAllow={(id) => onApprovalAllow?.(id)}
          onAllowAlways={onApprovalAllowAlways ? (id) => onApprovalAllowAlways(id) : undefined}
          onDeny={(id) => onApprovalDeny?.(id)}
        />
      )}
      <div className="relative">
        <ComposerCommandMenu
          open={slashMenuOpen}
          query={slashState?.query ?? ''}
          results={slashResults}
          activeIndex={slashActiveIndex}
          onHover={setSlashActiveIndex}
          onSelect={applySlash}
        />
        <div className="min-h-[5rem] rounded-md border bg-background pr-20">
          <ComposerPromptEditor
            placeholder={placeholder}
            disabled={disabled}
            onChange={setLastSerialized}
            onSubmit={handleSubmit}
            onMentionTrigger={handleMentionTrigger}
            onSlashTrigger={handleSlashTrigger}
            onEditorReady={setEditor}
            sessionId={sessionId}
          />
        </div>
        {mentionState && (
          <FileMentionPicker
            query={mentionState.query}
            anchorRect={mentionState.anchorRect ?? undefined}
            onSelect={handleMentionSelect}
            onDismiss={() => setMentionState(null)}
          />
        )}
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          {onAttach && (
            <Button size="icon" variant="ghost" onClick={onAttach} aria-label="Attach file" disabled={disabled}>
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
          {isStreaming ? (
            <Button size="icon" variant="destructive" onClick={onCancel} aria-label="Stop streaming">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="default"
              onClick={() => lastSerialized && handleSubmit(lastSerialized)}
              disabled={disabled || !hasContent}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {typeof contextUsed === 'number' && typeof contextTotal === 'number' && (
        <div className="flex justify-end">
          <ContextWindowMeter used={contextUsed} total={contextTotal} />
        </div>
      )}
    </div>
  );
};

LexicalChatComposer.displayName = 'LexicalChatComposer';

export default LexicalChatComposer;
