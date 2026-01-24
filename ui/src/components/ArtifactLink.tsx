/**
 * ArtifactLink Component
 *
 * Renders a clickable link for artifact notifications (documents or diagrams).
 * Displays as an inline hyperlink with an icon, type label, and artifact name.
 *
 * Features:
 * - Icon display (📄 for documents, 📊 for diagrams)
 * - Type indication (Created/Updated)
 * - Artifact name display
 * - Hyperlink styling (blue text, underline on hover)
 * - Dark mode support
 * - Accessible (button role, keyboard support)
 */

import React from 'react';

export interface ArtifactLinkProps {
  notification: {
    type: 'created' | 'updated';
    artifactType: 'document' | 'diagram';
    id: string;
    name: string;
  };
  onClick: (id: string, type: 'document' | 'diagram') => void;
}

/**
 * Get the appropriate icon emoji for the artifact type
 */
function getIconForArtifactType(artifactType: 'document' | 'diagram'): string {
  switch (artifactType) {
    case 'document':
      return '📄';
    case 'diagram':
      return '📊';
    default:
      return '📎';
  }
}

/**
 * Get the capitalized type label
 */
function getTypeLabel(type: 'created' | 'updated'): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export const ArtifactLink: React.FC<ArtifactLinkProps> = ({
  notification,
  onClick,
}) => {
  const handleClick = () => {
    onClick(notification.id, notification.artifactType);
  };

  const icon = getIconForArtifactType(notification.artifactType);
  const typeLabel = getTypeLabel(notification.type);

  return (
    <button
      onClick={handleClick}
      className="
        inline
        px-1 py-0.5
        text-blue-600 dark:text-blue-400
        hover:underline
        focus:outline-none
        focus:ring-2
        focus:ring-blue-500
        focus:ring-offset-1
        dark:focus:ring-offset-gray-900
        rounded
        transition-colors
        cursor-pointer
        text-sm
        font-medium
        whitespace-nowrap
      "
      title={`Click to view ${notification.artifactType}: ${notification.name}`}
    >
      <span className="mr-1">{icon}</span>
      {typeLabel}: {notification.name} (click to view)
    </button>
  );
};

ArtifactLink.displayName = 'ArtifactLink';
