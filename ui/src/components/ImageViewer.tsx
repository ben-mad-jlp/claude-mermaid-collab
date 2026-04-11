import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';

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

export const ImageViewer: React.FC = () => {
  const [imageError, setImageError] = useState(false);
  const { currentSession, images, selectedImageId } = useSessionStore(
    useShallow((state) => ({
      currentSession: state.currentSession,
      images: state.images,
      selectedImageId: state.selectedImageId,
    }))
  );

  const image = images.find((img) => img.id === selectedImageId);

  if (!image || !currentSession) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400 text-sm">No image selected</p>
      </div>
    );
  }

  const apiUrl = `/api/image/${encodeURIComponent(image.id)}/content?project=${encodeURIComponent(
    currentSession.project
  )}&session=${encodeURIComponent(currentSession.name)}`;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
          {image.name}
        </h2>
        {!imageError && (
          <a
            href={apiUrl}
            download={image.name}
            className="ml-2 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            title="Download image"
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
