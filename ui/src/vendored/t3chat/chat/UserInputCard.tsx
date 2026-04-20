import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { cn } from '../lib/utils';
import type { UserInputValue } from '@/types/agent';

export interface UserInputCardProps {
  promptId: string;
  prompt: string;
  expectedKind: 'text' | 'choice';
  choices?: Array<{ id: string; label: string }>;
  deadlineMs?: number;
  onRespond: (value: UserInputValue) => void;
  className?: string;
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export const UserInputCard: React.FC<UserInputCardProps> = ({
  promptId: _promptId,
  prompt,
  expectedKind,
  choices,
  deadlineMs,
  onRespond,
  className,
}) => {
  const [text, setText] = React.useState('');
  const [remainingMs, setRemainingMs] = React.useState<number | null>(
    typeof deadlineMs === 'number' ? Math.max(0, deadlineMs - Date.now()) : null,
  );

  React.useEffect(() => {
    if (typeof deadlineMs !== 'number') {
      setRemainingMs(null);
      return;
    }
    setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    const id = setInterval(() => {
      setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onRespond({ kind: 'text', text: trimmed });
  };

  return (
    <Card
      role="region"
      aria-label="Pending user input"
      className={cn('border-primary/30 bg-muted/30', className)}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm">Agent needs input</CardTitle>
          {remainingMs !== null && (
            <span
              aria-label="Time remaining"
              className="text-xs tabular-nums text-muted-foreground"
            >
              {formatMs(remainingMs)}
            </span>
          )}
        </div>
        <CardDescription className="whitespace-pre-wrap break-words text-sm text-foreground">
          {prompt}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {expectedKind === 'text' ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder="Type your response..."
              rows={3}
              aria-label="Response text"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={submitText}
                disabled={!text.trim()}
                aria-label="Submit response"
              >
                Submit
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(choices ?? []).map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="outline"
                onClick={() => onRespond({ kind: 'choice', choiceId: c.id })}
              >
                {c.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

UserInputCard.displayName = 'UserInputCard';
