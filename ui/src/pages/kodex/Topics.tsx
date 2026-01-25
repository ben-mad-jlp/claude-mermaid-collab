/**
 * Kodex Topics - Browse and manage topics
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kodexApi, type TopicMetadata } from '@/lib/kodex-api';
import { useSessionStore } from '@/stores/sessionStore';

const ConfidenceBadge: React.FC<{ confidence: TopicMetadata['confidence'] }> = ({ confidence }) => {
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

const TopicCard: React.FC<{ topic: TopicMetadata }> = ({ topic }) => {
  return (
    <Link
      to={`/kodex/topics/${topic.name}`}
      className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-white truncate">
            {topic.title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
            {topic.name}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <ConfidenceBadge confidence={topic.confidence} />
          {topic.verified && (
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
          {topic.hasDraft && (
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">
              Draft
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-400">
        Updated {new Date(topic.updatedAt).toLocaleDateString()}
      </div>
    </Link>
  );
};

export const Topics: React.FC = () => {
  const [topics, setTopics] = useState<TopicMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified' | 'has_draft'>('all');
  const [search, setSearch] = useState('');
  const currentSession = useSessionStore((s) => s.currentSession);

  useEffect(() => {
    if (!currentSession?.project) {
      setLoading(false);
      return;
    }

    const loadTopics = async () => {
      try {
        setLoading(true);
        const data = await kodexApi.listTopics(currentSession.project);
        setTopics(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topics');
      } finally {
        setLoading(false);
      }
    };

    loadTopics();
  }, [currentSession?.project]);

  // Filter topics
  const filteredTopics = topics.filter((topic) => {
    // Apply filter
    if (filter === 'verified' && !topic.verified) return false;
    if (filter === 'unverified' && topic.verified) return false;
    if (filter === 'has_draft' && !topic.hasDraft) return false;

    // Apply search
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        topic.name.toLowerCase().includes(searchLower) ||
        topic.title.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  if (!currentSession?.project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a session to view topics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Topics</h1>
        <Link
          to="/kodex/topics/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          New Topic
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search topics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-sm px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
        >
          <option value="all">All Topics</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
          <option value="has_draft">Has Draft</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Topics Grid */}
      {!loading && !error && (
        <>
          {filteredTopics.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">
                {topics.length === 0 ? 'No topics yet' : 'No topics match your filters'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTopics.map((topic) => (
                <TopicCard key={topic.name} topic={topic} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
