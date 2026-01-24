import React from 'react';

export interface MessageAreaProps {
  content: React.ReactNode;
  className?: string;
}

export function MessageArea({ content, className }: MessageAreaProps) {
  return (
    <div className={`message-area ${className || ''}`}>
      {content}
    </div>
  );
}
