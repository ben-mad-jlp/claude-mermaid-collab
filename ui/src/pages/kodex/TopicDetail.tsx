/**
 * Kodex TopicDetail - View a single topic
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { kodexApi, type Topic, type Flag } from '@/lib/kodex-api';
import { useSessionStore } from '@/stores/sessionStore';

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
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans">
          {content}
        </pre>
      </div>
    </div>
  );
};

export const TopicDetail: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagForm, setFlagForm] = useState<{ type: Flag['type']; description: string }>({ type: 'incomplete', description: '' });
  const currentSession = useSessionStore((s) => s.currentSession);

  useEffect(() => {
    if (!currentSession?.project || !name) {
      setLoading(false);
      return;
    }

    const loadTopic = async () => {
      try {
        setLoading(true);
        const data = await kodexApi.getTopic(currentSession.project, name);
        setTopic(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topic');
      } finally {
        setLoading(false);
      }
    };

    loadTopic();
  }, [currentSession?.project, name]);

  const handleFlag = async () => {
    if (!currentSession?.project || !name || !flagForm.description) return;
    try {
      await kodexApi.createFlag(
        currentSession.project,
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
    if (!currentSession?.project || !name) return;
    try {
      await kodexApi.verifyTopic(currentSession.project, name, 'user');
      // Reload topic to get updated verified status
      const data = await kodexApi.getTopic(currentSession.project, name);
      setTopic(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to verify topic');
    }
  };

  if (!currentSession?.project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a session to view topic</p>
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
            <Link
              to="/kodex/drafts"
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded"
            >
              Has Draft
            </Link>
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
      </div>

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

      {/* Content Sections */}
      <div className="space-y-4">
        <ContentSection title="Conceptual Overview" content={topic.content?.conceptual} />
        <ContentSection title="Technical Details" content={topic.content?.technical} />
        <ContentSection title="Related Files" content={topic.content?.files} />
        <ContentSection title="Related Topics" content={topic.content?.related} />
      </div>
    </div>
  );
};
