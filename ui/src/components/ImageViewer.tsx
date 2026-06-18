import React, { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionTabs } from '../stores/tabsStore';
import { SpritePlayer } from './SpritePlayer';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
  return `${size} ${sizes[i]}`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface ImageViewerProps {
  imageId?: string;
  project?: string;
  session?: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ imageId, project, session }) => {
  const [imageError, setImageError] = useState(false);
  const { currentSession, images } = useSessionStore(
    useShallow((state) => ({
      currentSession: state.currentSession,
      images: state.images,
    }))
  );
  const { tabs, activeTabId } = useSessionTabs();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const effectiveImageId =
    imageId ??
    (activeTab?.kind === 'artifact' && activeTab.artifactType === 'image'
      ? activeTab.artifactId
      : undefined);
  const effectiveProject = project ?? currentSession?.project;
  const effectiveSession = session ?? currentSession?.name;

  const image = images.find((img) => img.id === effectiveImageId);

  const [manifest, setManifest] = useState<any | null>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    let alive = true;
    setManifest(null); setAnimate(false);
    if (!effectiveImageId || !effectiveProject || !effectiveSession) return;
    const mUrl = `/api/image/${encodeURIComponent(effectiveImageId)}/manifest?project=${encodeURIComponent(effectiveProject)}&session=${encodeURIComponent(effectiveSession)}`;
    fetch(mUrl).then((r) => (r.ok ? r.json() : null)).then((m) => { if (alive && m && m.frames) setManifest(m); }).catch(() => {});
    return () => { alive = false; };
  }, [effectiveImageId, effectiveProject, effectiveSession]);

  if (!image || !effectiveProject || !effectiveSession) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400 text-sm">No media selected</p>
      </div>
    );
  }

  const apiUrl = `/api/image/${encodeURIComponent(image.id)}/content?project=${encodeURIComponent(
    effectiveProject
  )}&session=${encodeURIComponent(effectiveSession)}`;
  const manifestUrl = `/api/image/${encodeURIComponent(image.id)}/manifest?project=${encodeURIComponent(
    effectiveProject
  )}&session=${encodeURIComponent(effectiveSession)}`;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
          {image.name}
        </h2>
        {manifest && (
          <button
            onClick={() => setAnimate((a) => !a)}
            className="ml-2 px-3 py-1.5 text-xs font-medium text-info-600 dark:text-info-400 hover:bg-info-50 dark:hover:bg-info-900/20 rounded transition-colors"
            title="Play sprite-sheet animation"
          >
            {animate ? '🖼 Sheet' : '▶ Animate'}
          </button>
        )}
        {!imageError && (
          <a
            href={apiUrl}
            download={image.name}
            className="ml-2 px-3 py-1.5 text-xs font-medium text-info-600 dark:text-info-400 hover:bg-info-50 dark:hover:bg-info-900/20 rounded transition-colors"
            title="Download"
          >
            Download
          </a>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-gray-50 dark:bg-gray-800 p-4">
        {imageError ? (
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">Failed to load image</p>
          </div>
        ) : animate && manifest ? (
          <SpritePlayer atlasUrl={apiUrl} manifest={manifest} />
        ) : image.mimeType?.startsWith('video/') ? (
          <video
            src={apiUrl}
            controls
            onError={() => setImageError(true)}
            className="object-contain"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        ) : (
          <img
            src={apiUrl}
            alt={image.name}
            onError={() => setImageError(true)}
            className="object-contain"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">Type</p>
            <p className="text-gray-900 dark:text-gray-100 font-mono truncate">{image.mimeType}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">Size</p>
            <p className="text-gray-900 dark:text-gray-100">{formatSize(image.size)}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">Uploaded</p>
            <p className="text-gray-900 dark:text-gray-100">{formatDate(image.uploadedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageViewer;
