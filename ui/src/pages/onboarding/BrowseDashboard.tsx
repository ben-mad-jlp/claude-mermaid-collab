/**
 * Browse Dashboard - Topic list with category filters and search
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { TopicSummary, Category } from '@/lib/onboarding-api';

export const BrowseDashboard: React.FC = () => {
  const { project } = useOnboarding();
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      onboardingApi.getTopics(project),
      onboardingApi.getCategories(project),
    ]).then(([t, c]) => {
      setTopics(t);
      setCategories(c);
    }).finally(() => setLoading(false));
  }, [project]);

  const filteredTopics = useMemo(() => {
    if (selectedCategory === 'all') return topics;
    const cat = categories.find(c => c.name === selectedCategory);
    if (!cat) return topics;
    const topicSet = new Set(cat.topics);
    return topics.filter(t => topicSet.has(t.name));
  }, [topics, categories, selectedCategory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading topics...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Knowledge Base</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {topics.length} topics across {categories.length} categories
        </p>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            selectedCategory === 'all'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          All ({topics.length})
        </button>
        {categories.map(cat => (
          <button
            key={cat.name}
            onClick={() => setSelectedCategory(cat.name)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectedCategory === cat.name
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {cat.name} ({cat.topicCount})
          </button>
        ))}
      </div>

      {/* Topic Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredTopics.map(topic => (
          <Link
            key={topic.name}
            to={`/onboarding/topic/${topic.name}`}
            className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            <h3 className="font-medium text-sm mb-1 truncate">{topic.title}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{topic.name}</p>
          </Link>
        ))}
      </div>

      {filteredTopics.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No topics found in this category.
        </div>
      )}
    </div>
  );
};
