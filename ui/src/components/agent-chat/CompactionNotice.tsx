import React from 'react';

export interface CompactionNoticeProps {
  tokensBefore?: number;
  tokensAfter?: number;
  messagesRetained?: number;
  ts?: number;
}

export const CompactionNotice: React.FC<CompactionNoticeProps> = ({
  tokensBefore,
  tokensAfter,
  messagesRetained,
  ts,
}) => {
  const beforeText = tokensBefore != null ? `${tokensBefore}` : '?';
  const afterText = tokensAfter != null ? `${tokensAfter}` : '?';
  const retainedText = messagesRetained != null ? `${messagesRetained}` : '?';

  return (
    <div
      role="separator"
      aria-label="Context compacted"
      data-ts={ts}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '12px 0',
        gap: '8px',
        color: 'var(--muted-foreground, #888)',
        fontSize: '12px',
        fontStyle: 'italic',
      }}
    >
      <span
        style={{
          flex: 1,
          height: 1,
          background: 'currentColor',
          opacity: 0.3,
        }}
      />
      <span style={{ whiteSpace: 'nowrap' }}>
        Context compacted at {beforeText} tokens &rarr; {afterText} &middot; {retainedText} messages retained
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: 'currentColor',
          opacity: 0.3,
        }}
      />
    </div>
  );
};

export default CompactionNotice;
