import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

interface PRStatusBadgeProps {
  sessionId: string;
}

function checkColor(checks: string | undefined): string {
  if (!checks) return '#64748b'; // slate (unknown)
  const c = checks.toLowerCase();
  if (c.includes('pass') || c.includes('success') || c === 'green') {
    return '#16a34a'; // green
  }
  if (c.includes('fail') || c.includes('error') || c === 'red') {
    return '#dc2626'; // red
  }
  if (c.includes('pend') || c.includes('running') || c.includes('progress') || c === 'amber' || c === 'yellow') {
    return '#d97706'; // amber
  }
  return '#64748b';
}

export const PRStatusBadge: React.FC<PRStatusBadgeProps> = ({ sessionId }) => {
  const pr = useAgentStore((s) => s.prStatus[sessionId]);
  if (!pr) return null;

  const color = checkColor(pr.checks);

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Pull request #${pr.number}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        color: '#fff',
        backgroundColor: color,
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: '#fff',
          opacity: 0.85,
        }}
      />
      #{pr.number}
    </a>
  );
};

export default PRStatusBadge;
