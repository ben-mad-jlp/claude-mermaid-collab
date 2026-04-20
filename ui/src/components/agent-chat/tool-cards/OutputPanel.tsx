import React, { useState, useMemo } from 'react';

export interface OutputPanelProps {
  toolUseId: string;
  status: 'running' | 'ok' | 'error' | 'canceled';
  stdout?: string;
  stderr?: string;
  output?: unknown;
  error?: string;
  format?: 'ansi' | 'lines' | 'json' | 'text';
}

const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function deriveText(props: OutputPanelProps): string {
  const { status, stdout, stderr, output, error, format } = props;
  if (status === 'error') return error ?? stderr ?? stdout ?? (output != null ? String(output) : '');
  if (stderr && !stdout) return format === 'ansi' ? stripAnsi(stderr) : stderr;
  if (stdout != null) return format === 'ansi' ? stripAnsi(stdout) : stdout;
  if (output == null) return '';
  if (format === 'json' || typeof output === 'object') {
    try { return JSON.stringify(output, null, 2); } catch { return String(output); }
  }
  return String(output);
}

export const OutputPanel: React.FC<OutputPanelProps> = (props) => {
  const { toolUseId, status, format = 'text' } = props;
  const text = useMemo(() => deriveText(props), [props]);
  const lineCount = text ? text.split('\n').length : 0;
  const [expanded, setExpanded] = useState(status === 'error');

  if (status === 'canceled') {
    return (
      <div data-testid="output-panel" data-tool-use-id={toolUseId}
        className="text-xs italic text-gray-500 bg-gray-100 px-2 py-1 rounded">
        canceled
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div data-testid="output-panel" data-tool-use-id={toolUseId}
        className="text-[11px] font-mono bg-red-50 text-red-700 border border-red-200 rounded p-2 whitespace-pre-wrap break-all max-h-64 overflow-auto">
        {text || '(error)'}
      </div>
    );
  }

  const body = format === 'lines'
    ? text.split('\n').map((line, i) => (
        <div key={i}>
          <span className="text-gray-500 select-none mr-3 tabular-nums">{i + 1}</span>
          {line}
        </div>
      ))
    : text;

  return (
    <div data-testid="output-panel" data-tool-use-id={toolUseId}>
      {lineCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-[11px] text-gray-500 hover:text-gray-700 mb-1"
        >
          {expanded ? 'Hide output' : `Show output (${lineCount} line${lineCount === 1 ? '' : 's'})`}
        </button>
      )}
      {expanded && (
        <pre className="font-mono text-[11px] bg-gray-900 text-gray-100 rounded p-2 max-h-64 overflow-auto whitespace-pre">
          {body}
        </pre>
      )}
    </div>
  );
};

export default OutputPanel;
