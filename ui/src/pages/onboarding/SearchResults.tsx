/**
 * Search Results - FTS results with snippet highlighting
 */

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { SearchHit } from '@/lib/onboarding-api';

const FILE_TYPE_LABELS: Record<string, string> = {
  conceptual: 'Overview',
  technical: 'Technical',
  files: 'Files',
};

export const SearchResults: React.FC = () => {
  const { project } = useOnboarding();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';

  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project || !q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    onboardingApi.search(project, q)
      .then(setResults)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [project, q]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-xl font-bold mb-1">
        Search: &ldquo;{q}&rdquo;
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {loading ? 'Searching...' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {results.map((hit, i) => (
          <Link
            key={`${hit.topicName}-${hit.fileType}-${i}`}
            to={`/onboarding/topic/${hit.topicName}`}
            className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-sm">{hit.topicName}</span>
              <span className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
                {FILE_TYPE_LABELS[hit.fileType] || hit.fileType}
              </span>
            </div>
            <p
              className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 [&>mark]:bg-yellow-200 dark:[&>mark]:bg-yellow-800 [&>mark]:px-0.5 [&>mark]:rounded"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          </Link>
        ))}
      </div>

      {!loading && results.length === 0 && q.trim() && (
        <div className="text-center text-gray-400 py-12">
          No results found for &ldquo;{q}&rdquo;
        </div>
      )}
    </div>
  );
};
