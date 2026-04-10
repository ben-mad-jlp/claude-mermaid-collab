/**
 * LinkAndNavigateDialog Component
 *
 * Modal confirming "Link X and navigate to Y at line N?" before linking
 * an unlinked source file and jumping to the target location. Used by
 * Feature B (cross-file navigation) and GlobalSearch pseudo-kind results.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SourceLinkCandidate } from '@/lib/pseudo-api';

export interface LinkAndNavigateDialogProps {
  open: boolean;
  onClose: () => void;
  candidate: SourceLinkCandidate | null;
  symbolName: string;
  /** Parent is responsible for linking the file, then navigating. */
  onConfirm: () => Promise<void>;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

export const LinkAndNavigateDialog: React.FC<LinkAndNavigateDialogProps> = ({
  open,
  onClose,
  candidate,
  symbolName,
  onConfirm,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, isProcessing, onClose]);

  // Reset internal state when the dialog opens (the parent closes via `open=false`,
  // keeping the component mounted — without this, isProcessing stays stuck).
  useEffect(() => {
    if (open) {
      setError(null);
      setIsProcessing(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      await onConfirm();
      // Parent closes on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed');
      setIsProcessing(false);
    }
  }, [isProcessing, onConfirm]);

  if (!open || !candidate) return null;

  const fileName = basename(candidate.sourceFilePath);
  const lineSuffix = candidate.sourceLine != null ? ` at line ${candidate.sourceLine}` : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={() => !isProcessing && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Link and navigate"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Link file and navigate?
          </h3>
        </div>

        {/* Body */}
        <div className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
          <p className="mb-2">
            Link <code className="font-mono text-blue-600 dark:text-blue-400">{fileName}</code> and navigate to{' '}
            <code className="font-mono text-green-600 dark:text-green-400">{symbolName}</code>
            {lineSuffix}?
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate" title={candidate.sourceFilePath}>
            {candidate.sourceFilePath}
          </p>
          {error && (
            <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isProcessing
                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isProcessing ? 'Linking…' : 'Link and Navigate'}
          </button>
        </div>
      </div>
    </div>
  );
};

LinkAndNavigateDialog.displayName = 'LinkAndNavigateDialog';

export default LinkAndNavigateDialog;
