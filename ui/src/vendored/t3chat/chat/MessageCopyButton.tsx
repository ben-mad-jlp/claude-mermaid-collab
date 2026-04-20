import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';

export interface MessageCopyButtonProps {
  text: string;
  className?: string;
}

export const MessageCopyButton: React.FC<MessageCopyButtonProps> = ({ text, className }) => {
  const [copied, setCopied] = React.useState(false);

  const onClick = React.useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={copied ? 'Copied' : 'Copy message'}
      className={cn('h-7 w-7', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
};

MessageCopyButton.displayName = 'MessageCopyButton';
