import * as React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { AllowAllForCommandMenu } from '../../../components/agent-chat/AllowAllForCommandMenu';

export interface ComposerPendingApprovalActionsProps {
  onAllow: () => void;
  onAllowAlways?: () => void;
  onDeny: () => void;
  disabled?: boolean;
  className?: string;
  sessionId?: string;
  toolName?: string;
  toolInput?: unknown;
}

export const ComposerPendingApprovalActions: React.FC<ComposerPendingApprovalActionsProps> = ({
  onAllow,
  onAllowAlways,
  onDeny,
  disabled,
  className,
  sessionId,
  toolName,
  toolInput,
}) => (
  <div className={cn('flex items-center gap-2', className)}>
    <Button size="sm" variant="default" onClick={onAllow} disabled={disabled} aria-label="Allow once">
      <ShieldCheck className="h-3.5 w-3.5" />
      Allow
    </Button>
    {onAllowAlways && (
      <Button size="sm" variant="secondary" onClick={onAllowAlways} disabled={disabled} aria-label="Allow always for this session">
        Allow always
      </Button>
    )}
    {sessionId && (
      <AllowAllForCommandMenu
        sessionId={sessionId}
        toolName={toolName}
        input={toolInput}
        disabled={disabled}
      />
    )}
    <Button size="sm" variant="ghost" onClick={onDeny} disabled={disabled} aria-label="Deny">
      <X className="h-3.5 w-3.5" />
      Deny
    </Button>
  </div>
);

ComposerPendingApprovalActions.displayName = 'ComposerPendingApprovalActions';
