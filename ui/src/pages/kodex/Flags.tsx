/**
 * Kodex Flags - Review and resolve flagged topics
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kodexApi, type Flag } from '@/lib/kodex-api';
import { useKodexStore } from '@/stores/kodexStore';

const FlagTypeBadge: React.FC<{ type: Flag['type'] }> = ({ type }) => {
  const colors: Record<Flag['type'], string> = {
    outdated: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    incorrect: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    incomplete: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    missing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[type]}`}>
      {type.replace('_', ' ')}
    </span>
  );
};

const StatusBadge: React.FC<{ status: Flag['status'] }> = ({ status }) => {
  const colors: Record<Flag['status'], string> = {
    open: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    resolved: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    dismissed: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[status]}`}>
      {status}
    </span>
  );
};

export const Flags: React.FC = () => {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'dismissed'>('open');
  const selectedProject = useKodexStore((s) => s.selectedProject);

  const loadFlags = async () => {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const data = await kodexApi.listFlags(selectedProject);
      setFlags(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flags');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlags();
  }, [selectedProject]);

  const handleResolve = async (id: number) => {
    if (!selectedProject) return;
    try {
      await kodexApi.updateFlagStatus(selectedProject, id, 'resolved');
      loadFlags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resolve flag');
    }
  };

  const handleDismiss = async (id: number) => {
    if (!selectedProject) return;
    try {
      await kodexApi.updateFlagStatus(selectedProject, id, 'dismissed');
      loadFlags();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to dismiss flag');
    }
  };

  // Filter flags
  const filteredFlags = flags.filter((flag) => {
    if (filter === 'open') return flag.status === 'open';
    if (filter === 'resolved') return flag.status === 'resolved';
    if (filter === 'dismissed') return flag.status === 'dismissed';
    return true;
  });

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a project to view Kodex</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Flags</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && filteredFlags.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {filter === 'open' ? 'No open flags' : filter === 'resolved' ? 'No resolved flags' : filter === 'dismissed' ? 'No dismissed flags' : 'No flags'}
        </div>
      )}

      {!loading && !error && filteredFlags.length > 0 && (
        <div className="space-y-4">
          {filteredFlags.map((flag) => (
            <div
              key={flag.id}
              className={`p-4 rounded-lg border ${
                flag.status !== 'open'
                  ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Link
                      to={`/kodex/topics/${flag.topicName}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {flag.topicName}
                    </Link>
                    <FlagTypeBadge type={flag.type} />
                    <StatusBadge status={flag.status} />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{flag.description}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Created on {new Date(flag.createdAt).toLocaleDateString()}
                    {flag.resolvedAt && (
                      <> · Resolved on {new Date(flag.resolvedAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                {flag.status === 'open' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve(flag.id)}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => handleDismiss(flag.id)}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
