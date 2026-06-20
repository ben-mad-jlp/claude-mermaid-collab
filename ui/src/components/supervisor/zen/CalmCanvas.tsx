import React from 'react';

export interface CalmCanvasProps {
  children: React.ReactNode;
}

export const CalmCanvas: React.FC<CalmCanvasProps> = ({ children }) => (
  <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 dark:bg-gray-900">
    <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">
      {children}
    </div>
  </div>
);

export default CalmCanvas;
