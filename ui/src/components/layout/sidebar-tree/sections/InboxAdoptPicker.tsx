import React, { useEffect, useState } from 'react';
import { projectsApi, type Project } from '@/lib/projects-api';
import { api } from '@/lib/api';
import type { Session } from '@/types';
import { inboxAdoptPath, type InboxEnvelope } from '../artifactInbox';

export interface InboxAdoptPickerProps {
  envelope: InboxEnvelope;
  onAdopted: () => void;
  onCancel: () => void;
}

export function InboxAdoptPicker({
  envelope,
  onAdopted,
  onCancel,
}: InboxAdoptPickerProps): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [project, setProject] = useState('');
  const [session, setSession] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch(() => {
        setError('Failed to load projects');
      });
  }, []);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProject = e.target.value;
    setProject(newProject);
    setSession('');

    if (newProject) {
      api
        .getSessions(newProject)
        .then(setSessions)
        .catch(() => {
          setError('Failed to load sessions');
          setSessions([]);
        });
    } else {
      setSessions([]);
    }
  };

  const handleConfirm = async () => {
    if (!project || !session) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(inboxAdoptPath(envelope.envelopeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, session }),
      });

      if (response.ok) {
        onAdopted();
      } else {
        setError(`Adoption failed: ${response.statusText}`);
      }
    } catch (err) {
      setError(`Adoption failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="inbox-adopt-picker" className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4 m-2">
      <div className="mb-4">
        <label htmlFor="inbox-adopt-project" className="block text-sm font-medium mb-2">
          Project
        </label>
        <select
          id="inbox-adopt-project"
          data-testid="inbox-adopt-project"
          value={project}
          onChange={handleProjectChange}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">Select a project</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label htmlFor="inbox-adopt-session" className="block text-sm font-medium mb-2">
          Session
        </label>
        <select
          id="inbox-adopt-session"
          data-testid="inbox-adopt-session"
          value={session}
          onChange={(e) => setSession(e.target.value)}
          disabled={!project}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">Select a session</option>
          {sessions.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          data-testid="inbox-adopt-error"
          className="mb-4 p-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          data-testid="inbox-adopt-confirm"
          onClick={handleConfirm}
          disabled={!project || !session || submitting}
          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded font-medium"
        >
          {submitting ? 'Adopting...' : 'Adopt'}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-900 dark:text-white rounded font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
