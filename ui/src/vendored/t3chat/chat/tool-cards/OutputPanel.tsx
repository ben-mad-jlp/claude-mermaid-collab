import * as React from 'react';
import { cn } from '../../lib/utils';

export interface OutputPanelProps {
  toolUseId: string;
  status: 'running' | 'ok' | 'error' | 'canceled';
  stdout?: string;
  stderr?: string;
  output?: unknown;
  error?: string;
  format?: 'ansi' | 'lines' | 'json' | 'text';
  className?: string;
}

const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

function deriveText(props: OutputPanelProps): string {
  const { status, stdout, stderr, output, error, format } = props;
  if (status === 'error') {
    return error ?? stderr ?? stdout ?? (output != null ? String(output) : '');
  }
  if (stderr && !stdout) return format === 'ansi' ? stripAnsi(stderr) : stderr;
  if (stdout != null) return format === 'ansi' ? stripAnsi(stdout) : stdout;
  if (output == null) return '';
  if (format === 'json' || typeof output === 'object') {
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

export const OutputPanel: React.FC<OutputPanelProps> = (props) => {
  const { toolUseId, status, format = 'text', className } = props;
  const text = React.useMemo(() => deriveText(props), [props]);
  const lineCount = text ? text.split('\n').length : 0;
  const [expanded, setExpanded] = React.useState<boolean>(status === 'error');

  if (status === 'canceled') {
    return (
      <div
        data-testid="output-panel"
        data-tool-use-id={toolUseId}
        className={cn('text-xs italic text-muted-foreground rounded bg-muted px-2 py-1', className)}
      >
        canceled
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        data-testid="output-panel"
        data-tool-use-id={toolUseId}
        className={cn(
          'text-[11px] font-mono rounded border border-destructive/40 bg-destructive/10 text-destructive p-2 whitespace-pre-wrap break-all max-h-64 overflow-auto',
          className,
        )}
      >
        {text || '(error)'}
      </div>
    );
  }

  const body =
    format === 'lines'
      ? text.split('\n').map((line, i) => (
          <div key={i}>
            <span className="select-none mr-3 tabular-nums text-muted-foreground">{i + 1}</span>
            {line}
          </div>
        ))
      : text;

  return (
    <div data-testid="output-panel" data-tool-use-id={toolUseId} className={className}>
      {lineCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground mb-1"
        >
          {expanded ? 'Hide output' : `Show output (${lineCount} line${lineCount === 1 ? '' : 's'})`}
        </button>
      )}
      {expanded && (
        <pre className="font-mono text-[11px] rounded bg-muted text-foreground/90 p-2 max-h-64 overflow-auto whitespace-pre">
          {body}
        </pre>
      )}
    </div>
  );
};

OutputPanel.displayName = 'OutputPanel';

export default OutputPanel;
