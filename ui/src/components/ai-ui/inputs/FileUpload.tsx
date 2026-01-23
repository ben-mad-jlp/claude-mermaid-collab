import React, { useId, useRef, useState } from 'react';

export interface FileUploadProps {
  onChange?: (files: FileList | null) => void;
  name?: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  maxSize?: number;
  ariaLabel?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onChange,
  name,
  label,
  accept,
  multiple = false,
  disabled = false,
  maxSize,
  ariaLabel,
}) => {
  const id = useId();
  const inputId = `${id}-file-upload`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const validateFiles = (files: FileList): { valid: boolean; error?: string } => {
    if (maxSize) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].size > maxSize) {
          const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
          return { valid: false, error: `File "${files[i].name}" exceeds ${maxSizeMB}MB limit` };
        }
      }
    }
    return { valid: true };
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const validation = validateFiles(files);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setError(null);
    setSelectedFiles(Array.from(files));
    onChange?.(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const handleClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-900 dark:text-white"
        >
          {label}
        </label>
      )}

      {/* Drop zone */}
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative flex flex-col items-center justify-center
          w-full min-h-32 p-6
          border-2 border-dashed rounded-lg
          transition-colors cursor-pointer
          ${dragActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700'}
        `}
      >
        {/* Upload icon */}
        <svg
          className={`w-10 h-10 mb-3 ${dragActive ? 'text-blue-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>

        {selectedFiles.length > 0 ? (
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
            </p>
            <ul className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {selectedFiles.slice(0, 3).map((file, i) => (
                <li key={i}>{file.name} ({formatFileSize(file.size)})</li>
              ))}
              {selectedFiles.length > 3 && (
                <li>...and {selectedFiles.length - 3} more</li>
              )}
            </ul>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">
                Click to upload
              </span>
              {' '}or drag and drop
            </p>
            {accept && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                {accept}
              </p>
            )}
            {maxSize && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Max size: {formatFileSize(maxSize)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleInputChange}
        aria-label={ariaLabel || label}
        className="sr-only"
      />

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
};

FileUpload.displayName = 'FileUpload';
