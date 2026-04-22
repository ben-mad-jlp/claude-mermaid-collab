import { useState, useEffect, useRef, useId } from 'react';

export type MatcherStyle = 'exact' | 'wildcard' | 'domain' | 'path' | 'mcp';

export interface RuleMatcherInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

function buildMatcher(style: MatcherStyle, toolName: string, param: string): string {
  const tool = toolName.trim();
  const p = param.trim();
  switch (style) {
    case 'exact':    return p ? `${tool}(${p})` : tool;
    case 'wildcard': return p ? `${tool}(${p})` : tool;
    case 'domain':   return tool ? `${tool}(domain:${p})` : `domain:${p}`;
    case 'path':     return p ? `${tool}(${p})` : tool;
    case 'mcp':      return p;
  }
}

function parseMatcher(value: string): { style: MatcherStyle; toolName: string; param: string } {
  if (!value) return { style: 'exact', toolName: '', param: '' };
  if (value.startsWith('mcp__')) return { style: 'mcp', toolName: '', param: value };
  if (value.includes('(domain:')) {
    const [tool, rest] = value.split('(domain:');
    return { style: 'domain', toolName: tool ?? '', param: rest?.replace(')', '') ?? '' };
  }
  const parenIdx = value.indexOf('(');
  if (parenIdx !== -1) {
    const toolName = value.slice(0, parenIdx);
    const param = value.slice(parenIdx + 1, value.endsWith(')') ? value.length - 1 : value.length);
    if (/[*?[\]{}]/.test(param) || param.includes('**')) {
      return { style: 'wildcard', toolName, param };
    }
    if (param.startsWith('/')) {
      return { style: 'path', toolName, param };
    }
    return { style: 'exact', toolName, param };
  }
  return { style: 'exact', toolName: value, param: '' };
}

const STYLE_LABELS: Record<MatcherStyle, string> = {
  exact:    'Exact',
  wildcard: 'Wildcard',
  domain:   'Domain',
  path:     'Path',
  mcp:      'MCP',
};

const PARAM_LABELS: Record<MatcherStyle, string> = {
  exact:    'Pattern (optional)',
  wildcard: 'Glob pattern',
  domain:   'Domain',
  path:     'Path prefix',
  mcp:      'MCP tool pattern',
};

const PARAM_PLACEHOLDERS: Record<MatcherStyle, string> = {
  exact:    'exact string',
  wildcard: 'npm run *',
  domain:   'example.com',
  path:     '/srv/codebase/*',
  mcp:      'mcp__server__tool',
};

export function RuleMatcherInput({ value, onChange, disabled, className }: RuleMatcherInputProps) {
  const parsed = parseMatcher(value);
  const [style, setStyle] = useState<MatcherStyle>(parsed.style);
  const [toolName, setToolName] = useState(parsed.toolName);
  const [param, setParam] = useState(parsed.param);
  const initialized = useRef(false);
  const uid = useId();

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    onChange(buildMatcher(style, toolName, param));
  }, [style, toolName, param]); // eslint-disable-line react-hooks/exhaustive-deps

  const derived = buildMatcher(style, toolName, param);
  const inputBase = 'px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50';

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <label htmlFor={`${uid}-style`} className="sr-only">Matcher style</label>
          <select
            id={`${uid}-style`}
            data-testid="rule-matcher-style"
            value={style}
            onChange={e => setStyle(e.target.value as MatcherStyle)}
            disabled={disabled}
            className={`${inputBase} pr-6`}
          >
            {(Object.keys(STYLE_LABELS) as MatcherStyle[]).map(s => (
              <option key={s} value={s}>{STYLE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {style !== 'mcp' && (
          <div>
            <label htmlFor={`${uid}-tool`} className="sr-only">Tool name</label>
            <input
              id={`${uid}-tool`}
              data-testid="rule-matcher-tool"
              type="text"
              value={toolName}
              onChange={e => setToolName(e.target.value)}
              placeholder="Tool (e.g. Bash)"
              disabled={disabled}
              aria-label="Tool name"
              className={inputBase}
            />
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-param`} className="sr-only">{PARAM_LABELS[style]}</label>
          <input
            id={`${uid}-param`}
            data-testid="rule-matcher-param"
            type="text"
            value={param}
            onChange={e => setParam(e.target.value)}
            placeholder={PARAM_PLACEHOLDERS[style]}
            disabled={disabled}
            aria-label={PARAM_LABELS[style]}
            className={`${inputBase} ${style === 'mcp' ? 'font-mono' : ''}`}
          />
        </div>
      </div>

      {derived && (
        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" data-testid="rule-matcher-preview">
          → {derived}
        </p>
      )}
    </div>
  );
}

export default RuleMatcherInput;
