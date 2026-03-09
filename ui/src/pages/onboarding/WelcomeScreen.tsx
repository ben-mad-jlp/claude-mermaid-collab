/**
 * Welcome Screen - Name entry + returning user picker
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { User } from '@/lib/onboarding-api';

const LAST_USER_KEY = 'onboarding-last-user-id';

export const WelcomeScreen: React.FC = () => {
  const { project, setUser, setMode } = useOnboarding();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing users
  useEffect(() => {
    if (!project) return;
    setLoading(true);
    onboardingApi.listUsers(project)
      .then(setUsers)
      .finally(() => setLoading(false));
  }, [project]);

  // Select user and navigate
  const selectUser = useCallback((user: User) => {
    localStorage.setItem(LAST_USER_KEY, String(user.id));
    setUser(user);
    setMode('onboard');
    navigate('/onboarding/dashboard');
  }, [setUser, setMode, navigate]);

  // Create new user
  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !newName.trim()) return;
    setError(null);
    try {
      const user = await onboardingApi.createUser(project, newName.trim());
      selectUser(user);
    } catch (e: any) {
      setError(e.message || 'Failed to create user');
    }
  }, [project, newName, selectUser]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-16">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">Welcome to Onboarding</h1>
        <p className="text-gray-500 text-sm">Enter your name to track your learning progress</p>
      </div>

      {/* New user form */}
      <form onSubmit={handleCreate} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Your name"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-500">{error}</p>
        )}
      </form>

      {/* Returning users */}
      {users.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-3">Or continue as:</h3>
          <div className="flex flex-col gap-2">
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => selectUser(user)}
                className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-gray-400">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
