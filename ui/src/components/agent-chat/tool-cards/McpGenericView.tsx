import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import OutputPanel from './OutputPanel';

interface McpGenericViewProps {
  item: AgentToolCallItem;
}

export interface ParsedMcpName {
  server: string;
  tool: string;
  raw: string;
}

/**
 * Parses `mcp__<server>__<tool>` into its parts.
 * Server may itself contain underscores but not a double-underscore run, as the
 * canonical MCP name format uses `__` strictly as a delimiter.
 */
export function parseMcpToolName(name: string): ParsedMcpName | null {
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice('mcp__'.length);
  const sepIdx = rest.indexOf('__');
  if (sepIdx < 0) return null;
  const server = rest.slice(0, sepIdx);
  const tool = rest.slice(sepIdx + 2);
  if (!server || !tool) return null;
  return { server, tool, raw: name };
}

type AccentTheme = {
  serverBadge: string;
  toolBadge: string;
  frame: string;
};

const ACCENTS: Record<string, AccentTheme> = {
  mermaid: {
    serverBadge:
      'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700',
    toolBadge: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
    frame: 'border-l-2 border-green-400',
  },
  'chrome-devtools': {
    serverBadge:
      'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700',
    toolBadge: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
    frame: 'border-l-2 border-blue-400',
  },
  'ollama-coding': {
    serverBadge:
      'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700',
    toolBadge: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
    frame: 'border-l-2 border-purple-400',
  },
};

const DEFAULT_ACCENT: AccentTheme = {
  serverBadge:
    'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600',
  toolBadge: 'bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  frame: 'border-l-2 border-gray-300 dark:border-gray-600',
};

export function accentFor(server: string): AccentTheme {
  return ACCENTS[server] ?? DEFAULT_ACCENT;
}

const McpGenericView: React.FC<McpGenericViewProps> = ({ item }) => {
  const parsed = parseMcpToolName(item.name);
  const server = parsed?.server ?? 'mcp';
  const tool = parsed?.tool ?? item.name;
  const accent = accentFor(server);

  let inputJson = '';
  try {
    inputJson = JSON.stringify(item.input ?? {}, null, 2);
  } catch {
    inputJson = String(item.input);
  }

  return (
    <div className={`text-sm pl-2 ${accent.frame}`} data-testid="mcp-generic-view">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          data-testid="mcp-server-badge"
          data-server={server}
          className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${accent.serverBadge}`}
        >
          {server}
        </span>
        <span
          data-testid="mcp-tool-badge"
          className={`inline-flex items-center font-mono text-xs px-1.5 py-0.5 rounded ${accent.toolBadge}`}
        >
          {tool}
        </span>
      </div>

      {inputJson && inputJson !== '{}' && (
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
            Input
          </div>
          <pre
            data-testid="mcp-input-json"
            className="font-mono text-[11px] bg-gray-900 text-gray-100 rounded p-2 max-h-64 overflow-auto whitespace-pre"
          >
            {inputJson}
          </pre>
        </div>
      )}

      <OutputPanel
        toolUseId={item.id}
        status={item.status}
        output={item.output}
        error={item.error}
        format="json"
      />
    </div>
  );
};

export default McpGenericView;
