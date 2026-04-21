import * as React from 'react';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../lib/utils';
import type { SlashCommand } from './composerSlashCommandSearch';
import type { PendingApproval } from './ComposerPendingApprovalPanel';
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
  /** Invoked when a slash command is submitted. Return `true` to suppress the normal send. */
  onSlashCommand?: (id: string, args?: string) => boolean | void;
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

// Lazy-loaded Lexical implementation so the main bundle doesn't carry
// lexical/prosemirror weight until the chat composer is actually rendered.
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
  return (
    <React.Suspense fallback={<ComposerSkeleton className={props.className} />}>
      <LexicalChatComposer {...props} />
    </React.Suspense>
  );
};

ChatComposer.displayName = 'ChatComposer';
