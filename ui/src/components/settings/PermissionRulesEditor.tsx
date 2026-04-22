import { useState, useCallback } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { RuleMatcherInput } from './RuleMatcherInput';

interface RuleRow {
  id: string;
  source: 'global' | 'project' | 'local' | 'managed';
  verb: 'allow' | 'deny';
  matcher: string;
  managed: boolean;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'global': return 'User';
    case 'project': return 'Project';
    case 'local': return 'Local';
    case 'managed': return 'Managed';
    default: return source;
  }
}

const sourceBadgeClass: Record<string, string> = {
  global:  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  project: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  local:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  managed: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

export function PermissionRulesEditor() {
  const { data: settings, loading, error, mutate } = useSettings();
  const [draftVerb, setDraftVerb] = useState<'allow' | 'deny'>('allow');
  const [draftSource, setDraftSource] = useState<'global' | 'project' | 'local'>('project');
  const [draftMatcher, setDraftMatcher] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows: RuleRow[] = [];
  if (settings) {
    const rawAllow = (settings as { allowRules?: Array<{ rule: string; source: string }> }).allowRules ?? [];
    const rawDeny  = (settings as { denyRules?:  Array<{ rule: string; source: string }> }).denyRules  ?? [];
    for (const { rule, source } of rawAllow) {
      rows.push({ id: `allow-${source}-${rule}`, source: source as RuleRow['source'], verb: 'allow', matcher: rule, managed: source === 'managed' });
    }
    for (const { rule, source } of rawDeny) {
      rows.push({ id: `deny-${source}-${rule}`, source: source as RuleRow['source'], verb: 'deny', matcher: rule, managed: source === 'managed' });
    }
  }

  const handleRemove = useCallback(async (row: RuleRow) => {
    if (row.managed) return;
    setSaving(true);
    setSaveError(null);
    try {
      const merged = settings as { merged?: { permissions?: { allow?: string[]; deny?: string[] } } } | null;
      const current = merged?.merged?.permissions ?? {};
      const updated = {
        allow: (current.allow ?? []).filter(r => !(row.verb === 'allow' && r === row.matcher)),
        deny:  (current.deny  ?? []).filter(r => !(row.verb === 'deny'  && r === row.matcher)),
      };
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, patch: { permissions: updated } }),
      });
      await mutate();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [settings, mutate]);

  const handleAdd = useCallback(async () => {
    if (!draftMatcher.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: draftSource,
          patch: {
            permissions: {
              [draftVerb]: [draftMatcher.trim()],
            },
          },
        }),
      });
      setDraftMatcher('');
      await mutate();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [draftVerb, draftSource, draftMatcher, mutate]);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">Failed to load settings: {error.message}</p>;
  }

  return (
    <div className="space-y-4" data-testid="permission-rules-editor">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Permission Rules</h3>

      {saveError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}

      {/* Rules table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="pb-2 pr-3 font-medium">Source</th>
              <th className="pb-2 pr-3 font-medium">Verb</th>
              <th className="pb-2 pr-3 font-medium">Matcher</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  No permission rules configured.
                </td>
              </tr>
            )}
            {rows.map(row => (
              <tr key={row.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="py-2 pr-3">
                  <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${sourceBadgeClass[row.source] ?? sourceBadgeClass.local}`}>
                    {sourceLabel(row.source)}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
                    row.verb === 'allow'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                  }`}>
                    {row.verb}
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-gray-800 dark:text-gray-200 max-w-xs truncate">
                  {row.matcher}
                </td>
                <td className="py-2">
                  {row.managed ? (
                    <span title="Managed policy — cannot be edited" className="text-gray-400 dark:text-gray-500">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="6" width="10" height="7" rx="1" />
                        <path d="M4 6V4a3 3 0 016 0v2" />
                      </svg>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRemove(row)}
                      disabled={saving}
                      aria-label={`Remove ${row.verb} rule: ${row.matcher}`}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M11 3L3 11M3 3l8 8" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add rule form */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Add rule</p>
        <div className="flex items-start gap-2 flex-wrap">
          <select
            value={draftVerb}
            onChange={e => setDraftVerb(e.target.value as 'allow' | 'deny')}
            aria-label="Rule verb"
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
          <select
            value={draftSource}
            onChange={e => setDraftSource(e.target.value as 'global' | 'project' | 'local')}
            aria-label="Settings source"
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="global">User (~/.claude)</option>
            <option value="project">Project</option>
            <option value="local">Local</option>
          </select>
          <div className="flex-1 min-w-0">
            <RuleMatcherInput value={draftMatcher} onChange={setDraftMatcher} />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !draftMatcher.trim()}
            className="px-3 py-1 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionRulesEditor;
