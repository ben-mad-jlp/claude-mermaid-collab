import React from 'react';
import { resolveEmbedSrc, type EmbedKind } from '../../../../lib/milkdownEmbedBridge';

export interface DiagramEmbedViewProps {
  kind: EmbedKind;
  refId: string;
  project: string | undefined;
  session: string | undefined;
  theme?: string;
  selected?: boolean;
  onOpen?: (kind: EmbedKind, refId: string) => void;
  onSelect?: () => void;
}

export function DiagramEmbedView(props: DiagramEmbedViewProps): React.ReactElement {
  const { kind, refId, project, session, theme = 'dark', selected, onOpen, onSelect } = props;

  if (!refId || refId.trim() === '') {
    return (
      <div
        className="mc-embed mc-embed--broken"
        style={{
          border: '1px dashed var(--mc-border, #888)',
          padding: 8,
          borderRadius: 4,
          color: 'var(--mc-error, #c33)',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        Broken embed
      </div>
    );
  }

  const src = resolveEmbedSrc(kind, refId, project, session, theme);

  return (
    <div
      className={`mc-embed mc-embed--${kind}${selected ? ' mc-embed--selected' : ''}`}
      style={{
        border: '1px solid var(--mc-border, #444)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--mc-bg, #1e1e1e)',
        margin: '8px 0',
        cursor: 'pointer',
        outline: selected ? '2px solid var(--mc-accent, #4a9eff)' : 'none',
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpen?.(kind, refId);
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 8px',
          borderBottom: '1px solid var(--mc-border, #333)',
          fontSize: 12,
          fontFamily: 'monospace',
        }}
      >
        <span>
          {kind}:{refId}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOpen?.(kind, refId);
          }}
          style={{ color: 'var(--mc-accent, #4a9eff)', cursor: 'pointer' }}
        >
          Open
        </span>
      </div>
      {src ? (
        <iframe
          src={src}
          title={`${kind}:${refId}`}
          style={{
            width: '100%',
            height: 320,
            border: 'none',
            display: 'block',
            background: 'transparent',
          }}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div
          style={{
            padding: 16,
            color: 'var(--mc-muted, #888)',
            fontStyle: 'italic',
            fontSize: 12,
          }}
        >
          Embed unavailable (missing project/session)
        </div>
      )}
    </div>
  );
}

export default DiagramEmbedView;
