import React from 'react';

export interface AudioViewerProps {
  audioId: string;
  name: string;
  project?: string;
  session?: string;
}

/**
 * Audio artifact player: plays a generated audio clip with scrub + download.
 * Read-only; talks to /api/audio/:id/content.
 */
export const AudioViewer: React.FC<AudioViewerProps> = ({ audioId, name, project, session }) => {
  const q = `project=${encodeURIComponent(project ?? '')}&session=${encodeURIComponent(session ?? '')}`;
  const src = `/api/audio/${encodeURIComponent(audioId)}/content?${q}`;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-4 p-6">
        <audio key={src} controls src={src} className="w-full max-w-md" />
        <div className="flex items-center gap-2 text-xs">
          <a href={src} download className="px-3 py-1.5 text-info-600 dark:text-info-400 hover:underline">Download</a>
        </div>
      </div>
    </div>
  );
};

export default AudioViewer;
