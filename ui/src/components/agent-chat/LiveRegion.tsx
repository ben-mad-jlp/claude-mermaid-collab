import React from 'react';

export interface LiveRegionProps {
  message: string;
  level?: 'polite' | 'assertive';
}

/**
 * LiveRegion — sr-only aria-live region for announcing assistant/tool/permission
 * events to assistive technology. Updates to `message` propagate to screen readers.
 */
export function LiveRegion({ message, level = 'polite' }: LiveRegionProps) {
  return (
    <div className="sr-only" aria-live={level} aria-atomic="true">
      {message}
    </div>
  );
}

export default LiveRegion;
