/**
 * Topic Detail - Markdown tabs + related sidebar + onboarding features
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { TopicDetail as TopicDetailType, ProgressEntry, Note, DiagramBlock } from '@/lib/onboarding-api';
import { DiagramsTab } from './DiagramsTab';

type TabId = 'overview' | 'technical' | 'files' | 'related' | 'diagrams';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'technical', label: 'Technical' },
  { id: 'files', label: 'Files' },
  { id: 'related', label: 'Related' },
  { id: 'diagrams', label: 'Diagrams' },
];

export const TopicDetail: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const { project, mode, currentUser } = useOnboarding();

  const [topic, setTopic] = useState<TopicDetailType | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [diagrams, setDiagrams] = useState<DiagramBlock[]>([]);

  // Onboarding mode state
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');

  // Related topics parsed from content
  const [relatedTopics, setRelatedTopics] = useState<string[]>([]);

  // Fetch topic
  useEffect(() => {
    if (!project || !name) return;
    setLoading(true);
    onboardingApi.getTopic(project, name)
      .then(t => {
        setTopic(t);
        // Parse related links from content
        const links = parseRelatedLinks(t.content.related);
        setRelatedTopics(links);
      })
      .finally(() => setLoading(false));
  }, [project, name]);

  // Fetch diagrams
  useEffect(() => {
    if (!project || !name) return;
    onboardingApi.getDiagrams(project, name)
      .then(setDiagrams)
      .catch(() => setDiagrams([]));
  }, [project, name]);

  // Fetch user progress + notes in onboarding mode
  useEffect(() => {
    if (!project || !name || mode !== 'onboard' || !currentUser) return;
    onboardingApi.getProgress(project, currentUser.id).then(entries => {
      const entry = entries.find(e => e.topicName === name) || null;
      setProgress(entry);
    });
    onboardingApi.getNotes(project, currentUser.id, name).then(setNotes);
  }, [project, name, mode, currentUser]);

  // Mark progress
  const handleMark = useCallback(async (status: 'explored' | 'skipped') => {
    if (!project || !name || !currentUser) return;
    await onboardingApi.markProgress(project, currentUser.id, name, status);
    setProgress({ topicName: name, status, completedAt: new Date().toISOString() });
  }, [project, name, currentUser]);

  // Undo progress
  const handleUndo = useCallback(async () => {
    if (!project || !name || !currentUser) return;
    await onboardingApi.deleteProgress(project, currentUser.id, name);
    setProgress(null);
  }, [project, name, currentUser]);

  // Add note
  const handleAddNote = useCallback(async () => {
    if (!project || !name || !currentUser || !newNote.trim()) return;
    const note = await onboardingApi.addNote(project, currentUser.id, name, newNote.trim());
    setNotes(prev => [note, ...prev]);
    setNewNote('');
  }, [project, name, currentUser, newNote]);

  // Delete note
  const handleDeleteNote = useCallback(async (noteId: number) => {
    if (!project) return;
    await onboardingApi.deleteNote(project, noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, [project]);

  if (loading || !topic) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{loading ? 'Loading...' : 'Topic not found'}</div>
      </div>
    );
  }

  const tabContent: Record<TabId, string> = {
    overview: topic.content.conceptual,
    technical: topic.content.technical,
    files: topic.content.files,
    related: topic.content.related,
    diagrams: '',
  };

  return (
    <div className="max-w-6xl mx-auto p-6 flex gap-6">
      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold">{topic.title}</h1>
          <p className="text-sm text-gray-500 font-mono">{topic.name}</p>
        </div>

        {/* Onboarding: Progress buttons */}
        {mode === 'onboard' && currentUser && (
          <div className="flex items-center gap-2 mb-4">
            {progress ? (
              <>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  progress.status === 'explored'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                  {progress.status === 'explored' ? 'Explored' : 'Skipped'}
                </span>
                <button
                  onClick={handleUndo}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Undo
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleMark('explored')}
                  className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  Mark Done
                </button>
                <button
                  onClick={() => handleMark('skipped')}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                >
                  Skip
                </button>
              </>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="prose dark:prose-invert max-w-none prose-sm">
          {activeTab === 'diagrams' ? (
            <DiagramsTab diagrams={diagrams} />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {tabContent[activeTab] || '*No content available*'}
            </ReactMarkdown>
          )}
        </div>

        {/* Onboarding: Notes section */}
        {mode === 'onboard' && currentUser && (
          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold mb-3">Notes</h3>
            <div className="flex gap-2 mb-4">
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed self-end"
              >
                Add
              </button>
            </div>
            {notes.map(note => (
              <div key={note.id} className="mb-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                <p className="whitespace-pre-wrap">{note.content}</p>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-red-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Related Sidebar */}
      {relatedTopics.length > 0 && (
        <aside className="w-56 shrink-0">
          <h3 className="text-sm font-semibold mb-3 text-gray-600 dark:text-gray-400">Related Topics</h3>
          <div className="flex flex-col gap-1">
            {relatedTopics.map(rt => (
              <Link
                key={rt}
                to={`/onboarding/topic/${rt}`}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
              >
                {rt}
              </Link>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
};

/**
 * Parse related topic links from related.md content.
 * Extracts topic slugs from markdown links.
 */
function parseRelatedLinks(content: string): string[] {
  if (!content) return [];
  const links: string[] = [];
  const regex = /\[([^\]]*)\]\(\.\.\/([a-z0-9-]+)\/?[^)]*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[2]);
  }
  // Also try bold links
  const boldRegex = /\*\*([a-z0-9-]+)\*\*/g;
  while ((match = boldRegex.exec(content)) !== null) {
    if (!links.includes(match[1])) {
      links.push(match[1]);
    }
  }
  return links;
}
