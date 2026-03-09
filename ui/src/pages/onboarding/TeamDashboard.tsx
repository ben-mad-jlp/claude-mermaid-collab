/**
 * Team Dashboard - Team progress overview for onboarding
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { TeamMember, TopicSummary, Category } from '@/lib/onboarding-api';

export const TeamDashboard: React.FC = () => {
  const { project, mode, currentUser } = useOnboarding();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      onboardingApi.getTeam(project),
      onboardingApi.getTopics(project),
      onboardingApi.getCategories(project),
    ]).then(([t, tp, c]) => {
      setTeam(t);
      setTopics(tp);
      setCategories(c);
    }).finally(() => setLoading(false));
  }, [project]);

  const totalTopics = topics.length;

  // Category coverage: for each category, how many team members explored all its topics
  const categoryCoverage = useMemo(() => {
    return categories.map(cat => {
      const membersComplete = team.filter(m =>
        cat.topics.every(t => m.exploredTopics.includes(t))
      ).length;
      return {
        name: cat.name,
        topicCount: cat.topicCount,
        membersComplete,
        totalMembers: team.length,
      };
    });
  }, [categories, team]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading team data...</div>
      </div>
    );
  }

  if (team.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-xl font-bold mb-4">Team Progress</h2>
        <div className="text-center text-gray-400 py-12">
          No team members yet. Start onboarding to appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Team Progress</h2>

      {/* Team overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {team.map(member => {
          const explored = member.exploredTopics.length;
          const pct = totalTopics > 0 ? Math.round((explored / totalTopics) * 100) : 0;
          const isCurrentUser = currentUser?.id === member.id;

          return (
            <div
              key={member.id}
              className={`p-4 rounded-lg border ${
                isCurrentUser
                  ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {member.name}
                    {isCurrentUser && (
                      <span className="ml-1.5 text-xs text-blue-500">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {explored}/{totalTopics} topics ({pct}%)
                  </p>
                </div>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Category coverage */}
      {categoryCoverage.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3">Category Coverage</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-medium">Category</th>
                  <th className="text-left py-2 px-3 font-medium">Topics</th>
                  <th className="text-left py-2 px-3 font-medium">Members Complete</th>
                </tr>
              </thead>
              <tbody>
                {categoryCoverage.map(cat => (
                  <tr key={cat.name} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 capitalize">{cat.name}</td>
                    <td className="py-2 px-3 text-gray-500">{cat.topicCount}</td>
                    <td className="py-2 px-3">
                      <span className={cat.membersComplete === cat.totalMembers ? 'text-green-600' : 'text-gray-500'}>
                        {cat.membersComplete}/{cat.totalMembers}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Topic heatmap */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Topic Completion</h3>
        <div className="flex flex-col gap-1">
          {topics.map(topic => {
            const exploredBy = team.filter(m => m.exploredTopics.includes(topic.name)).length;
            const ratio = team.length > 0 ? exploredBy / team.length : 0;
            return (
              <Link
                key={topic.name}
                to={`/onboarding/topic/${topic.name}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    backgroundColor: ratio >= 1
                      ? '#22c55e'
                      : ratio > 0
                      ? '#facc15'
                      : '#e5e7eb',
                  }}
                />
                <span className="text-sm flex-1">{topic.title}</span>
                <span className="text-xs text-gray-400">
                  {exploredBy}/{team.length}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};
