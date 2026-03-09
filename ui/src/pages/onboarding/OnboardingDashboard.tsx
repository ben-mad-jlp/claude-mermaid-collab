/**
 * Onboarding Dashboard - Progress tracking + What's Next
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { TopicSummary, Category, ProgressEntry, GraphNode, GraphEdge } from '@/lib/onboarding-api';

interface WhatNextSuggestion {
  topicName: string;
  reason: string;
  connectionCount: number;
}

export const OnboardingDashboard: React.FC = () => {
  const { project, mode, currentUser } = useOnboarding();
  const navigate = useNavigate();

  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  // Redirect to browse if not in onboard mode
  useEffect(() => {
    if (mode !== 'onboard' || !currentUser) {
      navigate('/onboarding');
    }
  }, [mode, currentUser, navigate]);

  // Fetch data
  useEffect(() => {
    if (!project || !currentUser) return;
    setLoading(true);
    Promise.all([
      onboardingApi.getTopics(project),
      onboardingApi.getCategories(project),
      onboardingApi.getProgress(project, currentUser.id),
      onboardingApi.getGraph(project),
    ]).then(([t, c, p, g]) => {
      setTopics(t);
      setCategories(c);
      setProgress(p);
      setGraph(g);
    }).finally(() => setLoading(false));
  }, [project, currentUser]);

  // Compute progress stats
  const exploredSet = useMemo(() => new Set(
    progress.filter(p => p.status === 'explored').map(p => p.topicName)
  ), [progress]);

  const skippedSet = useMemo(() => new Set(
    progress.filter(p => p.status === 'skipped').map(p => p.topicName)
  ), [progress]);

  const pct = topics.length > 0 ? Math.round((exploredSet.size / topics.length) * 100) : 0;

  // Compute "What's Next" suggestions
  const suggestions = useMemo<WhatNextSuggestion[]>(() => {
    return computeWhatNext(graph, exploredSet);
  }, [graph, exploredSet]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">
          Welcome back, {currentUser?.name}
        </h2>
        <p className="text-sm text-gray-500">
          {exploredSet.size} of {topics.length} topics explored ({pct}%)
        </p>
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* What's Next */}
      {suggestions.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3">What's Next</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {suggestions.map(s => (
              <Link
                key={s.topicName}
                to={`/onboarding/topic/${s.topicName}`}
                className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg hover:border-blue-400 transition-colors"
              >
                <p className="font-medium text-sm mb-1">{s.topicName}</p>
                <p className="text-xs text-gray-500">{s.reason}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Category Progress Cards */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">By Category</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {categories.map(cat => {
            const explored = cat.topics.filter(t => exploredSet.has(t)).length;
            const catPct = cat.topicCount > 0 ? Math.round((explored / cat.topicCount) * 100) : 0;
            return (
              <div key={cat.name} className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <p className="text-sm font-medium capitalize mb-1">{cat.name}</p>
                <p className="text-xs text-gray-500 mb-2">{explored}/{cat.topicCount}</p>
                <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${catPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Topic List with Status */}
      <h3 className="text-lg font-semibold mb-3">All Topics</h3>
      <div className="flex flex-col gap-1">
        {topics.map(topic => (
          <Link
            key={topic.name}
            to={`/onboarding/topic/${topic.name}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <div className={`w-2 h-2 rounded-full ${
              exploredSet.has(topic.name)
                ? 'bg-green-500'
                : skippedSet.has(topic.name)
                ? 'bg-gray-400'
                : 'bg-gray-200 dark:bg-gray-600'
            }`} />
            <span className="text-sm">{topic.title}</span>
            <span className="text-xs text-gray-400 font-mono">{topic.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};

/**
 * Compute "What's Next" suggestions from graph data.
 */
function computeWhatNext(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  exploredTopics: Set<string>,
): WhatNextSuggestion[] {
  if (graph.nodes.length === 0) return [];

  const scores = new Map<string, number>();

  for (const edge of graph.edges) {
    // If source is explored, boost target
    if (exploredTopics.has(edge.source) && !exploredTopics.has(edge.target)) {
      scores.set(edge.target, (scores.get(edge.target) || 0) + 1);
    }
    // If target is explored, boost source
    if (exploredTopics.has(edge.target) && !exploredTopics.has(edge.source)) {
      scores.set(edge.source, (scores.get(edge.source) || 0) + 1);
    }
  }

  // If no scores yet (nothing explored), pick most-connected nodes
  if (scores.size === 0) {
    const connectionCounts = new Map<string, number>();
    for (const edge of graph.edges) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
    }
    for (const [topic, count] of connectionCounts) {
      if (!exploredTopics.has(topic)) {
        scores.set(topic, count);
      }
    }
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topicName, count]) => ({
      topicName,
      reason: exploredTopics.size > 0
        ? `Related to ${count} topic${count !== 1 ? 's' : ''} you've explored`
        : `Connected to ${count} other topic${count !== 1 ? 's' : ''}`,
      connectionCount: count,
    }));
}
