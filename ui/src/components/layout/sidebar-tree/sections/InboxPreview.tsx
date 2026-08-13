import React from 'react';
import type { InboxEnvelope } from '../artifactInbox';

export interface InboxPreviewProps {
  envelope: InboxEnvelope;
  onClose: () => void;
}

export function InboxPreview({ envelope, onClose }: InboxPreviewProps): React.ReactElement {
  const sender = envelope.from.serverOwner ?? envelope.from.baseUrl ?? 'unknown';

  return (
    <div
      data-testid="inbox-preview"
      className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 flex flex-col gap-3 max-h-96 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-grow">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
            {envelope.artifact.type}
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {envelope.artifact.name}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            from {sender}
          </div>
          {envelope.from.note && (
            <div className="text-xs text-gray-700 dark:text-gray-300 italic mt-1">
              {envelope.from.note}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          data-testid="inbox-preview-close"
          className="flex-shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
          aria-label="Close preview"
        >
          ×
        </button>
      </div>

      {/* History note */}
      {envelope.historyNote && (
        <div
          data-testid="inbox-preview-history-note"
          className="text-xs bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded px-2 py-1.5 text-yellow-800 dark:text-yellow-200"
        >
          <div className="font-semibold mb-0.5">History did not travel</div>
          <div>
            {envelope.historyNote.versions} version{envelope.historyNote.versions !== 1 ? 's' : ''} from {envelope.historyNote.firstAt} to {envelope.historyNote.lastAt}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-grow min-h-0">
        {envelope.artifact.type === 'image' ? (
          <img
            data-testid="inbox-preview-image"
            src={envelope.artifact.content}
            alt={envelope.artifact.name}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <pre
            data-testid="inbox-preview-content"
            className="text-xs whitespace-pre-wrap word-break break-words font-mono text-gray-700 dark:text-gray-300"
          >
            {envelope.artifact.content}
          </pre>
        )}
      </div>
    </div>
  );
}

export default InboxPreview;
