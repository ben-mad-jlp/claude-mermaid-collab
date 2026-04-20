import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';

export interface CommitPushPRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; body?: string; draft?: boolean }) => void;
}

export const CommitPushPRModal: React.FC<CommitPushPRModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const commitInFlight = useAgentStore((s) => s.commitInFlight);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setBody('');
      setDraft(false);
      // Defer focus to next tick to ensure input is mounted
      window.setTimeout(() => titleRef.current?.focus(), 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const canSubmit = title.trim().length > 0 && !commitInFlight;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      body: body.trim() ? body.trim() : undefined,
      draft,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !commitInFlight) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-push-pr-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4"
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="commit-push-pr-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            Commit, Push &amp; open PR
          </h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label
              htmlFor="commit-pr-title-input"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="commit-pr-title-input"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={commitInFlight}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
              placeholder="feat: short summary"
              required
            />
          </div>
          <div>
            <label
              htmlFor="commit-pr-body-input"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Body (optional)
            </label>
            <textarea
              id="commit-pr-body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={commitInFlight}
              rows={6}
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
              placeholder="Details about the change…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
              disabled={commitInFlight}
            />
            Open as draft PR
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={commitInFlight}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-accent-600 text-white hover:bg-accent-700 focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 outline-none disabled:opacity-60"
          >
            {commitInFlight ? 'Submitting…' : 'Commit · Push · PR'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CommitPushPRModal;
