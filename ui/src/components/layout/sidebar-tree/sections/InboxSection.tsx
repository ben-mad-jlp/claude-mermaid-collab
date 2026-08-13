import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import { useArtifactInbox } from '../useArtifactInbox';
import { InboxPreview } from './InboxPreview';
import { InboxAdoptPicker } from './InboxAdoptPicker';
import { inboxDismissPath, type InboxEnvelope, type ArtifactType } from '../artifactInbox';

export interface InboxSectionProps {
  collapsed: boolean;
  forceExpanded: boolean;
  onToggle: () => void;
}

function formatReceived(receivedAt: string): string {
  const received = new Date(receivedAt);
  if (isNaN(received.getTime())) {
    return receivedAt;
  }

  const now = new Date();
  const diffMs = now.getTime() - received.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

function getArtifactTypeGlyph(type: ArtifactType): string {
  const glyphs: Record<ArtifactType, string> = {
    document: '📄',
    diagram: '📊',
    design: '🎨',
    spreadsheet: '📋',
    snippet: '</> ',
    image: '🖼️',
    embed: '🔗',
  };
  return glyphs[type] || '📦';
}

function renderEnvelopeRow(
  envelope: InboxEnvelope,
  onSelect: (e: InboxEnvelope) => void,
  onAdopt: (e: InboxEnvelope) => void,
  onDismiss: (e: InboxEnvelope) => void
): React.ReactElement {
  const sender = envelope.from.serverOwner ?? envelope.from.baseUrl ?? 'unknown';
  const time = formatReceived(envelope.receivedAt);
  const glyph = getArtifactTypeGlyph(envelope.artifact.type);

  return (
    <div
      key={envelope.envelopeId}
      data-testid={`inbox-row-${envelope.envelopeId}`}
      style={{ paddingLeft: '16px' }}
      onClick={() => onSelect(envelope)}
      role="button"
      tabIndex={0}
      className="flex items-center gap-2 py-1.5 px-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 select-none cursor-pointer"
    >
      <span className="flex-shrink-0">{glyph}</span>
      <span className="flex-grow truncate font-medium">{envelope.artifact.name}</span>
      <span className="flex-shrink-0 text-gray-500 dark:text-gray-400 italic">
        {sender}
      </span>
      <span className="flex-shrink-0 text-gray-400 dark:text-gray-500 italic">
        {time}
      </span>
      <button
        data-testid={`inbox-adopt-${envelope.envelopeId}`}
        onClick={(e) => {
          e.stopPropagation();
          onAdopt(envelope);
        }}
        className="flex-shrink-0 px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
      >
        Adopt
      </button>
      <button
        data-testid={`inbox-dismiss-${envelope.envelopeId}`}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(envelope);
        }}
        className="flex-shrink-0 px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-xs font-medium"
      >
        Dismiss
      </button>
    </div>
  );
}

export function InboxSection({
  collapsed,
  forceExpanded,
  onToggle,
}: InboxSectionProps): React.ReactElement {
  const { envelopes, refetch } = useArtifactInbox();
  const [previewEnvelope, setPreviewEnvelope] = React.useState<InboxEnvelope | null>(null);
  const [adoptEnvelope, setAdoptEnvelope] = React.useState<InboxEnvelope | null>(null);

  const showChildren = !collapsed || forceExpanded;

  const handleSelectEnvelope = (envelope: InboxEnvelope) => {
    if (previewEnvelope?.envelopeId === envelope.envelopeId) {
      setPreviewEnvelope(null);
    } else {
      setPreviewEnvelope(envelope);
    }
  };

  const handleAdoptEnvelope = (envelope: InboxEnvelope) => {
    setAdoptEnvelope(envelope);
  };

  const handleDismissEnvelope = async (envelope: InboxEnvelope) => {
    try {
      const response = await fetch(inboxDismissPath(envelope.envelopeId), {
        method: 'POST',
      });

      if (response.ok) {
        refetch();
      }
    } catch {
      // Silently ignore errors as per spec
    }
  };

  return (
    <React.Fragment>
      <SectionBranchRow
        id="inbox"
        title="Inbox"
        count={envelopes.length}
        collapsed={collapsed && !forceExpanded}
        onToggle={onToggle}
        level={0}
      />
      {showChildren && envelopes.map((env) => renderEnvelopeRow(env, handleSelectEnvelope, handleAdoptEnvelope, handleDismissEnvelope))}
      {previewEnvelope && (
        <InboxPreview
          envelope={previewEnvelope}
          onClose={() => setPreviewEnvelope(null)}
        />
      )}
      {adoptEnvelope && (
        <InboxAdoptPicker
          envelope={adoptEnvelope}
          onAdopted={() => {
            setAdoptEnvelope(null);
            refetch();
          }}
          onCancel={() => setAdoptEnvelope(null)}
        />
      )}
    </React.Fragment>
  );
}

export default InboxSection;
