import * as React from 'react';
import { Shield } from 'lucide-react';
import { cn } from '../lib/utils';
import { ComposerPendingApprovalActions } from './ComposerPendingApprovalActions';

export interface PendingApproval {
  promptId: string;
  toolName: string;
  summary?: string;
  input?: unknown;
}

export interface ComposerPendingApprovalPanelProps {
  pending: PendingApproval | null;
  onAllow: (promptId: string) => void;
  onAllowAlways?: (promptId: string) => void;
  onDeny: (promptId: string) => void;
  disabled?: boolean;
  className?: string;
  sessionId?: string;
}

export const ComposerPendingApprovalPanel: React.FC<ComposerPendingApprovalPanelProps> = ({
  pending,
  onAllow,
  onAllowAlways,
  onDeny,
  disabled,
  className,
  sessionId,
}) => {
  if (!pending) return null;
  return (
    <div
      role="region"
      aria-label="Pending tool approval"
      className={cn(
        'flex items-start gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm',
        className
      )}
    >
      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div>
          <span className="font-medium">
            {pending.toolName && pending.toolName.length > 0
              ? pending.toolName
              : 'Tool'}
          </span>
          <span className="ml-2 text-muted-foreground">
            needs approval
            {pending.summary ? <> — {pending.summary}</> : null}
          </span>
        </div>
        <ComposerPendingApprovalActions
          onAllow={() => onAllow(pending.promptId)}
          onAllowAlways={onAllowAlways ? () => onAllowAlways(pending.promptId) : undefined}
          onDeny={() => onDeny(pending.promptId)}
          disabled={disabled}
          sessionId={sessionId}
          toolName={pending.toolName}
          toolInput={pending.input}
        />
      </div>
    </div>
  );
};

ComposerPendingApprovalPanel.displayName = 'ComposerPendingApprovalPanel';
