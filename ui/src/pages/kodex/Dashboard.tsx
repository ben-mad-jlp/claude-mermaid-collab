/**
 * Kodex Dashboard - Overview stats and recent activity
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kodexApi, type DashboardStats } from '@/lib/kodex-api';
import { useSessionStore } from '@/stores/sessionStore';

const StatCard: React.FC<{
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  link?: string;
}> = ({ label, value, icon, color, link }) => {
  const content = (
    <div className={`p-4 rounded-lg border ${color}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
          {icon}
        </div>
      </div>
    </div>
  );

  if (link) {
    return <Link to={link}>{content}</Link>;
  }
  return content;
};

export const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useSessionStore((s) => s.currentSession);

  useEffect(() => {
    if (!currentSession?.project) {
      setLoading(false);
      return;
    }

    const loadStats = async () => {
      try {
        setLoading(true);
        const data = await kodexApi.getDashboard(currentSession.project);
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, [currentSession?.project]);

  if (!currentSession?.project) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400">
            Select a session to view Kodex dashboard
          </p>
          <Link to="/" className="text-blue-600 hover:underline mt-2 inline-block">
            Go to Collab
          </Link>
        </div>
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
      <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
        <p className="text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Topics"
          value={stats.totalTopics}
          color="border-blue-200 dark:border-blue-800"
          link="/kodex/topics"
          icon={
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
        />
        <StatCard
          label="Verified"
          value={stats.verifiedTopics}
          color="border-green-200 dark:border-green-800"
          icon={
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Pending Drafts"
          value={stats.pendingDrafts}
          color="border-yellow-200 dark:border-yellow-800"
          link="/kodex/drafts"
          icon={
            <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
        <StatCard
          label="Open Flags"
          value={stats.openFlags}
          color="border-red-200 dark:border-red-800"
          link="/kodex/flags"
          icon={
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
          }
        />
      </div>

      {/* Recent Activity & Missing Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Access */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Recent Access</h2>
          {stats.recentAccess.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No recent activity</p>
          ) : (
            <ul className="space-y-2">
              {stats.recentAccess.slice(0, 5).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <Link
                    to={`/kodex/topics/${entry.topicName}`}
                    className="text-blue-600 hover:underline"
                  >
                    {entry.topicName}
                  </Link>
                  <span className="text-gray-500 dark:text-gray-400">
                    {new Date(entry.accessedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top Missing */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Missing Topics</h2>
          {stats.topMissing.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No missing topics requested</p>
          ) : (
            <ul className="space-y-2">
              {stats.topMissing.slice(0, 5).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{entry.topicName}</span>
                  <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded text-xs">
                    {entry.count} requests
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
