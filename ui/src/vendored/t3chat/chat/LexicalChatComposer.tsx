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
import { $getRoot } from 'lexical';
import type { ChatComposerProps } from './ChatComposer';

// Locally-intercepted slash commands which, when submitted as a single-pill
// skill mention with no surrounding content, route through `onSlashCommand`
// instead of `onSend`.
const LOCAL_INTERCEPT_COMMANDS = new Set(['clear', 'help']);

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
}) => {
  const [editor, setEditor] = React.useState<LexicalEditor | null>(null);
  const [mentionState, setMentionState] = React.useState<PickerState | null>(null);
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

      // Single-pill intercept: exactly one skill mention with no non-whitespace
      // surrounding text maps to local slash command handling.
      const { text, mentions } = serialized;
      if (mentions.length === 1 && mentions[0].kind === 'skill') {
        const m = mentions[0];
        const before = text.slice(0, m.range.from);
        const after = text.slice(m.range.to);
        if (!before.trim() && !after.trim() && LOCAL_INTERCEPT_COMMANDS.has(m.value)) {
          if (onSlashCommand) onSlashCommand(m.value);
          clearEditor();
          return;
        }
      }

      if (!text.trim() && mentions.length === 0) return;
      if (onSendSerialized) {
        onSendSerialized(serialized);
      } else {
        onSend(text);
      }
    },
    [disabled, isStreaming, onSend, onSendSerialized, onSlashCommand, clearEditor]
  );

  const hasContent =
    !!lastSerialized &&
    (lastSerialized.text.trim().length > 0 || lastSerialized.mentions.length > 0);

  return (
    <div className={cn('relative flex flex-col gap-2 border-t bg-background p-3', className)}>
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
