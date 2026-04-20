import * as React from 'react';
import { Send, Square, Paperclip } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../lib/utils';
import {
  searchSlashCommands,
  type SlashCommand,
  type SlashSearchResult,
} from './composerSlashCommandSearch';
import { detectSlashTrigger } from './composer-logic';
import { ComposerCommandMenu } from './ComposerCommandMenu';
import {
  ComposerPendingApprovalPanel,
  type PendingApproval,
} from './ComposerPendingApprovalPanel';
import { ContextWindowMeter } from './ContextWindowMeter';
import { ModeSelector } from './ModeSelector';
import type { ComposerSerialized } from './composer-editor-serialize';
import type { RuntimeMode, InteractionMode } from '@/types/agent';

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  /**
   * Optional richer handler invoked in Lexical mode with the full serialized
   * editor state (text + mentions). When omitted, Lexical mode falls back to
   * calling `onSend(serialized.text)`.
   */
  onSendSerialized?: (serialized: ComposerSerialized) => void;
  onCancel?: () => void;
  onAttach?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: readonly SlashCommand[];
  onSlashCommand?: (id: string) => boolean | void;
  pending?: PendingApproval | null;
  onApprovalAllow?: (promptId: string) => void;
  onApprovalAllowAlways?: (promptId: string) => void;
  onApprovalDeny?: (promptId: string) => void;
  contextUsed?: number;
  contextTotal?: number;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  onRuntimeChange?: (mode: RuntimeMode) => void;
  onInteractionChange?: (mode: InteractionMode) => void;
  className?: string;
}

function lexicalEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    return env?.VITE_COMPOSER_LEXICAL === 'true';
  } catch {
    return false;
  }
}

// Lazy-loaded Lexical implementation so the main bundle doesn't carry
// lexical/prosemirror weight until the chat composer is actually rendered
// with the lexical flag enabled.
const LexicalChatComposer = React.lazy(() => import('./LexicalChatComposer'));

const ComposerSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('relative flex flex-col gap-2 border-t bg-background p-3', className)}>
    <div className="relative">
      <div className="min-h-[5rem] rounded-md border bg-background pr-20 p-3">
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  </div>
);

export const ChatComposer: React.FC<ChatComposerProps> = (props) => {
  if (lexicalEnabled()) {
    return (
      <React.Suspense fallback={<ComposerSkeleton className={props.className} />}>
        <LexicalChatComposer {...props} />
      </React.Suspense>
    );
  }
  return <TextareaChatComposer {...props} />;
};

ChatComposer.displayName = 'ChatComposer';

// ---------------------------------------------------------------------------
// Legacy textarea-backed composer (unchanged behavior).
// ---------------------------------------------------------------------------

const TextareaChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSend,
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
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const trigger = React.useMemo(
    () => detectSlashTrigger(value, caret),
    [value, caret]
  );
  const results: SlashSearchResult[] = React.useMemo(
    () => (trigger ? searchSlashCommands(slashCommands, trigger.query) : []),
    [trigger, slashCommands]
  );
  const menuOpen = !!trigger && results.length > 0;

  React.useEffect(() => {
    if (menuOpen) setActiveIndex(0);
  }, [trigger?.query, menuOpen]);

  const applySlash = (i: number) => {
    const cmd = results[i]?.command;
    if (!cmd) return;
    if (onSlashCommand?.(cmd.id)) {
      onChange('');
      return;
    }
    if (!trigger) return;
    const next = value.slice(0, trigger.start) + '/' + cmd.name + ' ' + value.slice(trigger.end);
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySlash(activeIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !isStreaming && value.trim()) {
        onSend(value);
      }
    }
  };

  const onChangeText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
  };

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
          open={menuOpen}
          query={trigger?.query ?? ''}
          results={results}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={applySlash}
        />
        <Textarea
          ref={taRef}
          value={value}
          onChange={onChangeText}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          placeholder={placeholder}
          disabled={disabled}
          rows={3}
          className="resize-none pr-20"
        />
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
              onClick={() => value.trim() && onSend(value)}
              disabled={disabled || !value.trim()}
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
