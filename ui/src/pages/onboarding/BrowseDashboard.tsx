/**
 * Browse Dashboard - File list with directory filters and search
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { TopicSummary, Category } from '@/lib/onboarding-api';

export const BrowseDashboard: React.FC = () => {
  const { project } = useOnboarding();
  const [files, setFiles] = useState<TopicSummary[]>([]);
  const [directories, setDirectories] = useState<Category[]>([]);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      onboardingApi.getFiles(project),
      onboardingApi.getDirectories(project),
    ]).then(([f, d]) => {
      setFiles(f);
      setDirectories(d);
    }).finally(() => setLoading(false));
  }, [project]);

  const filteredFiles = useMemo(() => {
    if (selectedDirectory === 'all') return files;
    const dir = directories.find(d => d.name === selectedDirectory);
    if (!dir) return files;
    const fileSet = new Set(dir.files);
    return files.filter(f => fileSet.has(f.filePath));
  }, [files, directories, selectedDirectory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading files...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Codebase Files</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {files.length} files across {directories.length} directories
        </p>
      </div>

      {/* Directory Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setSelectedDirectory('all')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            selectedDirectory === 'all'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          All ({files.length})
        </button>
        {directories.map(dir => (
          <button
            key={dir.name}
            onClick={() => setSelectedDirectory(dir.name)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectedDirectory === dir.name
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {dir.name} ({dir.topicCount})
          </button>
        ))}
      </div>

      {/* File Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredFiles.map(file => (
          <Link
            key={file.filePath}
            to={`/onboarding/topic/${file.filePath}`}
            className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            <h3 className="font-medium text-sm mb-1 truncate">{file.filePath}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{file.filePath}</p>
          </Link>
        ))}
      </div>

      {filteredFiles.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No files found in this directory.
        </div>
      )}
    </div>
  );
};
