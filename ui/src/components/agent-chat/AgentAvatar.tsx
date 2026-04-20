import React from 'react';

export type AgentAvatarKind = 'user' | 'main_agent' | 'subagent' | 'hook' | 'system';

export interface AgentAvatarProps {
  kind: AgentAvatarKind;
  name?: string;
}

interface AvatarConfig {
  bg: string;
  label: string;
}

function getConfig(kind: AgentAvatarKind, name?: string): AvatarConfig {
  switch (kind) {
    case 'user': {
      const initial = name && name.trim().length > 0 ? name.trim()[0]!.toUpperCase() : 'U';
      return { bg: '#3b82f6', label: initial };
    }
    case 'main_agent':
      return { bg: '#a855f7', label: 'C' };
    case 'subagent':
      return { bg: '#22c55e', label: 'S' };
    case 'hook':
      return { bg: '#f59e0b', label: 'H' };
    case 'system':
      return { bg: '#6b7280', label: '\u00B7' };
  }
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({ kind, name }) => {
  const { bg, label } = getConfig(kind, name);
  const title = kind === 'subagent' && name ? name : undefined;

  return (
    <div
      data-testid="agent-avatar"
      data-kind={kind}
      title={title}
      aria-label={`${kind} avatar`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: '50%',
        backgroundColor: bg,
        color: '#ffffff',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
};

export default AgentAvatar;
