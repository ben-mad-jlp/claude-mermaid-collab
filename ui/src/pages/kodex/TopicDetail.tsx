/**
 * Kodex TopicDetail - View a single topic
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { kodexApi, type Topic, type Flag, type Draft } from '@/lib/kodex-api';
import { useKodexStore } from '@/stores/kodexStore';

const ConfidenceBadge: React.FC<{ confidence: Topic['confidence'] }> = ({ confidence }) => {
  const colors = {
    low: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    high: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[confidence]}`}>
      {confidence}
    </span>
  );
};

const ContentSection: React.FC<{ title: string; content?: string }> = ({ title, content }) => {
  if (!content) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-medium text-gray-900 dark:text-white mb-3">{title}</h3>
      <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans bg-transparent">
        {content}
      </pre>
    </div>
  );
};

const DraftComparisonSection: React.FC<{
  title: string;
  liveContent?: string;
  draftContent?: string;
}> = ({ title, liveContent, draftContent }) => {
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

export const TopicDetail: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagForm, setFlagForm] = useState<{ type: Flag['type']; description: string }>({ type: 'incomplete', description: '' });
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const selectedProject = useKodexStore((s) => s.selectedProject);

  useEffect(() => {
    if (!selectedProject || !name) {
      setLoading(false);
      return;
    }

    const loadTopic = async () => {
      try {
        setLoading(true);
        const data = await kodexApi.getTopic(selectedProject, name);
        setTopic(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topic');
      } finally {
        setLoading(false);
      }
    };

    loadTopic();
  }, [selectedProject, name]);

  const handleFlag = async () => {
    if (!selectedProject || !name || !flagForm.description) return;
    try {
      await kodexApi.createFlag(
        selectedProject,
        name,
        flagForm.type,
        flagForm.description
      );
      setFlagging(false);
      setFlagForm({ type: 'incomplete', description: '' });
      alert('Topic flagged successfully');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to flag topic');
    }
  };

  const handleVerify = async () => {
    if (!selectedProject || !name) return;
    try {
      await kodexApi.verifyTopic(selectedProject, name, 'user');
      // Reload topic to get updated verified status
      const data = await kodexApi.getTopic(selectedProject, name);
      setTopic(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify topic');
    }
  };

  const handleDelete = async () => {
    if (!selectedProject || !name || deleteConfirmText !== name) return;
    try {
      await kodexApi.deleteTopic(selectedProject, name);
      navigate('/kodex/topics');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete topic');
    }
  };

  // Auto-load draft when topic has one
  useEffect(() => {
    if (!selectedProject || !name || !topic?.hasDraft) {
      setDraft(null);
      return;
    }

    const loadDraft = async () => {
      setLoadingDraft(true);
      try {
        const drafts = await kodexApi.listDrafts(selectedProject);
        const topicDraft = drafts.find((d) => d.topicName === name);
        setDraft(topicDraft || null);
      } catch {
        setDraft(null);
      } finally {
        setLoadingDraft(false);
      }
    };

    loadDraft();
  }, [selectedProject, name, topic?.hasDraft]);

  const handleApproveDraft = async () => {
    if (!selectedProject || !name) return;
    try {
      await kodexApi.approveDraft(selectedProject, name);
      // Reload topic to get updated content
      const data = await kodexApi.getTopic(selectedProject, name);
      setTopic(data);
      setDraft(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve draft');
    }
  };

  const handleRejectDraft = async () => {
    if (!selectedProject || !name) return;
    if (!confirm('Are you sure you want to reject this draft?')) return;
    try {
      await kodexApi.rejectDraft(selectedProject, name);
      // Reload topic to clear hasDraft flag
      const data = await kodexApi.getTopic(selectedProject, name);
      setTopic(data);
      setDraft(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject draft');
    }
  };

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a project to view Kodex</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/kodex/topics" className="text-blue-600 hover:underline">
          &larr; Back to Topics
        </Link>
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="space-y-4">
        <Link to="/kodex/topics" className="text-blue-600 hover:underline">
          &larr; Back to Topics
        </Link>
        <div className="text-center py-12 text-gray-500">Topic not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/kodex/topics" className="text-blue-600 hover:underline text-sm">
            &larr; Back to Topics
          </Link>
          <h1 className="text-2xl font-bold mt-2">{topic.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{topic.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={topic.confidence} />
          {topic.verified && (
            <span className="px-2 py-1 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified
            </span>
          )}
          {topic.hasDraft && (
            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">
              Has Draft
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!topic.verified && (
          <button
            onClick={handleVerify}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Mark as Verified
          </button>
        )}
        <button
          onClick={() => setFlagging(!flagging)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {flagging ? 'Cancel' : 'Flag Topic'}
        </button>
        <button
          onClick={() => setDeleting(true)}
          className="px-4 py-2 border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          Delete Topic
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Topic</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              This action cannot be undone. This will permanently delete the topic
              <span className="font-mono font-semibold text-gray-900 dark:text-white"> {name}</span>.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Please type <span className="font-mono font-semibold text-gray-900 dark:text-white">{name}</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type topic name to confirm"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDeleting(false);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== name}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Form */}
      {flagging && (
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-4">
          <h3 className="font-medium">Flag this topic</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={flagForm.type}
                onChange={(e) => setFlagForm({ ...flagForm, type: e.target.value as Flag['type'] })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              >
                <option value="incomplete">Incomplete</option>
                <option value="outdated">Outdated</option>
                <option value="incorrect">Incorrect</option>
                <option value="missing">Missing</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={flagForm.description}
                onChange={(e) => setFlagForm({ ...flagForm, description: e.target.value })}
                placeholder="What's the issue?"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
          </div>
          <button
            onClick={handleFlag}
            disabled={!flagForm.description}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Submit Flag
          </button>
        </div>
      )}

      {/* Metadata */}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        <p>Created on {new Date(topic.createdAt).toLocaleDateString()}</p>
        <p>Last updated {new Date(topic.updatedAt).toLocaleDateString()}</p>
        {topic.verified && topic.verifiedBy && (
          <p>Verified by {topic.verifiedBy} on {new Date(topic.verifiedAt!).toLocaleDateString()}</p>
        )}
      </div>

      {/* Draft Comparison Section */}
      {topic.hasDraft && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h3 className="font-medium text-gray-900 dark:text-white">Draft Changes</h3>
              {draft && (
                <span className="text-sm text-gray-500">
                  {draft.reason} &middot; by {draft.createdBy}
                </span>
              )}
            </div>
            {draft && (
              <div className="flex gap-2">
                <button
                  onClick={handleApproveDraft}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={handleRejectDraft}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            )}
          </div>

          {loadingDraft ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : draft ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <h4 className="text-sm font-medium text-gray-500">Current</h4>
                <h4 className="text-sm font-medium text-gray-500">Draft</h4>
              </div>
              <DraftComparisonSection
                title="Conceptual Overview"
                liveContent={topic.content?.conceptual}
                draftContent={draft.content.conceptual}
              />
              <DraftComparisonSection
                title="Technical Details"
                liveContent={topic.content?.technical}
                draftContent={draft.content.technical}
              />
              <DraftComparisonSection
                title="Related Files"
                liveContent={topic.content?.files}
                draftContent={draft.content.files}
              />
              <DraftComparisonSection
                title="Related Topics"
                liveContent={topic.content?.related}
                draftContent={draft.content.related}
              />
            </>
          ) : (
            <p className="text-center py-4 text-gray-500">Draft not found</p>
          )}
        </div>
      )}

      {/* Content Sections */}
      {!topic.hasDraft && (
        <div className="space-y-4">
          <ContentSection title="Conceptual Overview" content={topic.content?.conceptual} />
          <ContentSection title="Technical Details" content={topic.content?.technical} />
          <ContentSection title="Related Files" content={topic.content?.files} />
          <ContentSection title="Related Topics" content={topic.content?.related} />
        </div>
      )}
    </div>
  );
};
