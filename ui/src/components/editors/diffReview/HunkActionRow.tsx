import React, { useState } from 'react';
import type * as Monaco from 'monaco-editor';

export interface HunkActionRowProps {
  hunk: Monaco.editor.ILineChange;
  index: number;
  total: number;
  top: number;
  readOnly: boolean;
  onAccept: (comment?: string) => void;
  onReject: (comment?: string) => void;
}

export const HunkActionRow: React.FC<HunkActionRowProps> = ({
  hunk,
  index,
  total,
  top,
  readOnly,
  onAccept,
  onReject,
}) => {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [lastAction, setLastAction] = useState<'accept' | 'reject'>('accept');

  const addedCount =
    hunk.modifiedStartLineNumber > 0
      ? Math.max(0, hunk.modifiedEndLineNumber - hunk.modifiedStartLineNumber + 1)
      : 0;
  const removedCount =
    hunk.originalStartLineNumber > 0
      ? Math.max(0, hunk.originalEndLineNumber - hunk.originalStartLineNumber + 1)
      : 0;

  const handleAccept = () => {
    onAccept(commentText || undefined);
    setCommentText('');
    setCommentOpen(false);
    setLastAction('accept');
  };

  const handleReject = () => {
    onReject(commentText || undefined);
    setCommentText('');
    setCommentOpen(false);
    setLastAction('reject');
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (lastAction === 'accept') {
        handleAccept();
      } else {
        handleReject();
      }
    }
    if (e.key === 'Escape') {
      setCommentOpen(false);
    }
  };

  return (
    <div
      style={{ top: `${top}px` }}
      className="absolute right-2 z-10 flex flex-col gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm shadow-sm px-2 py-1"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">
          {index + 1}/{total} +{addedCount} −{removedCount}
        </span>
        {!readOnly && (
          <>
            <button
              onClick={handleAccept}
              className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 transition-colors flex-shrink-0"
            >
              ✓
            </button>
            <button
              onClick={handleReject}
              className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 transition-colors flex-shrink-0"
            >
              ✗
            </button>
          </>
        )}
        <button
          onClick={() => setCommentOpen((o) => !o)}
          title="Add comment"
          className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors flex-shrink-0 ${
            commentOpen
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          💬
        </button>
      </div>
      {commentOpen && (
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={handleCommentKeyDown}
          placeholder="Comment… (⌘Enter to submit)"
          rows={3}
          className="w-48 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          autoFocus
        />
      )}
    </div>
  );
};

export default HunkActionRow;
