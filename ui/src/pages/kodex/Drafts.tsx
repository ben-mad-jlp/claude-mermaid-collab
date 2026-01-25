/**
 * Kodex Drafts - Review pending drafts
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kodexApi, type Draft, type Topic, type TopicContent } from '@/lib/kodex-api';
import { useSessionStore } from '@/stores/sessionStore';

const ContentSection: React.FC<{ title: string; draftContent?: string; liveContent?: string }> = ({
  title,
  draftContent,
  liveContent,
}) => {
  const hasChanges = draftContent !== liveContent;

  return (
    <div className="mb-4">
      <h4 className="font-medium text-sm text-gray-900 dark:text-white mb-2 flex items-center gap-2">
        {title}
        {hasChanges && (
          <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded">
            Changed
          </span>
        )}
      </h4>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
          <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans bg-transparent min-h-[60px]">
            {liveContent || <span className="text-gray-400 italic">No content</span>}
          </pre>
        </div>
        <div className={`rounded-lg border p-3 ${hasChanges ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-600'}`}>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans bg-transparent min-h-[60px]">
            {draftContent || <span className="text-gray-400 italic">No content</span>}
          </pre>
        </div>
      </div>
    </div>
  );
};

export const Drafts: React.FC = () => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [liveTopic, setLiveTopic] = useState<Topic | null>(null);
  const [loadingLiveTopic, setLoadingLiveTopic] = useState(false);
  const currentSession = useSessionStore((s) => s.currentSession);

  const handleExpand = async (topicName: string) => {
    if (expandedDraft === topicName) {
      setExpandedDraft(null);
      setLiveTopic(null);
      return;
    }

    setExpandedDraft(topicName);
    setLiveTopic(null);
    setLoadingLiveTopic(true);

    try {
      const topic = await kodexApi.getTopic(currentSession!.project, topicName);
      setLiveTopic(topic);
    } catch {
      // Topic might not exist yet (new topic draft)
      setLiveTopic(null);
    } finally {
      setLoadingLiveTopic(false);
    }
  };

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
          {drafts.map((draft) => {
            const isExpanded = expandedDraft === draft.topicName;
            return (
              <div
                key={draft.topicName}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="p-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-lg">{draft.topicName}</h3>
                    <p className="text-sm text-gray-500 mt-1">{draft.reason}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Created by {draft.createdBy} on {new Date(draft.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleExpand(draft.topicName)}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
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

                {isExpanded && draft.content && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="grid grid-cols-2 gap-4 flex-1">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Live Topic
                          {!loadingLiveTopic && !liveTopic && (
                            <span className="ml-2 text-xs text-gray-400">(New topic)</span>
                          )}
                        </h4>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Draft Changes
                        </h4>
                      </div>
                      {liveTopic && (
                        <Link
                          to={`/kodex/topics/${draft.topicName}`}
                          className="text-sm text-blue-600 hover:underline ml-4"
                        >
                          Open Topic &rarr;
                        </Link>
                      )}
                    </div>

                    {loadingLiveTopic ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    ) : (
                      <>
                        <ContentSection
                          title="Conceptual Overview"
                          liveContent={liveTopic?.content?.conceptual}
                          draftContent={draft.content.conceptual}
                        />
                        <ContentSection
                          title="Technical Details"
                          liveContent={liveTopic?.content?.technical}
                          draftContent={draft.content.technical}
                        />
                        <ContentSection
                          title="Related Files"
                          liveContent={liveTopic?.content?.files}
                          draftContent={draft.content.files}
                        />
                        <ContentSection
                          title="Related Topics"
                          liveContent={liveTopic?.content?.related}
                          draftContent={draft.content.related}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
