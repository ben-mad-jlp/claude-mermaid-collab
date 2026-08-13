import React from 'react';
import { Download, Trash2, X } from 'lucide-react';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { INBOX_LIST_PATH, type InboxEnvelope } from '../artifactInbox';

export interface InboxViewerProps {
  envelope: InboxEnvelope;
  onAdopt: (e: InboxEnvelope) => void;
  onDismiss: (e: InboxEnvelope) => void;
  onClose: () => void;
}

/**
 * Full main-area read-only viewer for a pending inbox envelope — an envelope opens
 * like any other artifact, not as a sidebar sliver. Viewing mutates NOTHING; only
 * the adopt/dismiss actions transition the envelope. The LIST route is a metadata
 * projection, so the full envelope (with content) is fetched here on open.
 */
export function InboxViewer({ envelope, onAdopt, onDismiss, onClose }: InboxViewerProps): React.ReactElement {
  const [full, setFull] = React.useState<InboxEnvelope | null>(
    envelope.artifact?.content ? envelope : null
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (full) return;
    let cancelled = false;
    fetch(`${INBOX_LIST_PATH}/${envelope.envelopeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((e: InboxEnvelope) => { if (!cancelled) setFull(e); })
      .catch(() => { if (!cancelled) setError('Could not load the envelope content.'); });
    return () => { cancelled = true; };
  }, [envelope.envelopeId, full]);

  const sender = envelope.from?.serverOwner ?? envelope.from?.baseUrl ?? 'unknown';
  const art = full?.artifact ?? envelope.artifact;

  return (
    <div
      data-testid="inbox-viewer"
      className="fixed inset-y-0 right-0 left-[320px] z-40 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700"
    >
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{art?.type ?? 'artifact'}</span>
        <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">{art?.name ?? '(unnamed)'}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 italic">from {sender}</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            data-testid={`inbox-adopt-${envelope.envelopeId}`}
            title="Adopt into a project/session"
            onClick={() => onAdopt(full ?? envelope)}
            className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:text-success-600 dark:hover:text-success-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Download size={16} />
          </button>
          <button
            data-testid={`inbox-dismiss-${envelope.envelopeId}`}
            title="Dismiss"
            onClick={() => onDismiss(envelope)}
            className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Trash2 size={16} />
          </button>
          <button
            data-testid="inbox-viewer-close"
            title="Close"
            onClick={onClose}
            className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </span>
      </div>
      {envelope.historyNote && (
        <div
          data-testid="inbox-viewer-history-note"
          className="px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700"
        >
          {envelope.historyNote.versions} version{envelope.historyNote.versions !== 1 ? 's' : ''} from {envelope.historyNote.firstAt} to {envelope.historyNote.lastAt}
        </div>
      )}
      <div data-testid="inbox-viewer-content" className="flex-1 overflow-y-auto px-6 py-4">
        {error && <div className="text-danger-600 text-sm">{error}</div>}
        {!error && !full && <div className="text-gray-500 text-sm">Loading…</div>}
        {!error && full && (
          art.type === 'image'
            ? <img src={art.content} alt={art.name} className="max-w-full" />
            : <MarkdownPreview content={art.content} />
        )}
      </div>
    </div>
  );
}

export default InboxViewer;
