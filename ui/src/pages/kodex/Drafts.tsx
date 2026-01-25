/**
 * Kodex Drafts - Review pending drafts
 */

import React, { useEffect, useState } from 'react';
import { kodexApi, type Draft } from '@/lib/kodex-api';
import { useSessionStore } from '@/stores/sessionStore';

export const Drafts: React.FC = () => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useSessionStore((s) => s.currentSession);

  const loadDrafts = async () => {
    if (!currentSession?.project) return;
    try {
      setLoading(true);
      const data = await kodexApi.listDrafts(currentSession.project);
      setDrafts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [currentSession?.project]);

  const handleApprove = async (name: string) => {
    if (!currentSession?.project) return;
    try {
      await kodexApi.approveDraft(currentSession.project, name);
      loadDrafts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handleReject = async (name: string) => {
    if (!currentSession?.project) return;
    if (!confirm('Are you sure you want to reject this draft?')) return;
    try {
      await kodexApi.rejectDraft(currentSession.project, name);
      loadDrafts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject');
    }
  };

  if (!currentSession?.project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a session to view drafts</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pending Drafts</h1>

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

      {!loading && !error && drafts.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No pending drafts
        </div>
      )}

      {!loading && !error && drafts.length > 0 && (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <div
              key={draft.topicName}
              className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-lg">{draft.topicName}</h3>
                  <p className="text-sm text-gray-500 mt-1">{draft.reason}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Created by {draft.createdBy} on {new Date(draft.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(draft.topicName)}
                    className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(draft.topicName)}
                    className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
