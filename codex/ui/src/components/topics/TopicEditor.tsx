/**
 * TopicEditor Component
 *
 * Topic create/edit form with document tabs, code editor,
 * and save/cancel actions.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { DocumentType } from '../../types';
import { DocumentTabs } from './DocumentTabs';
import { CodeMirrorEditor } from '../common/CodeMirrorEditor';
import { NameInput } from '../common/NameInput';

/**
 * Document content for all document types
 */
export interface TopicDocuments {
  conceptual: string;
  technical: string;
  files: string;
  related: string;
}

export interface TopicEditorProps {
  /** Topic name (undefined for create mode) */
  topicName?: string;
  /** Initial document content */
  initialDocuments?: TopicDocuments;
  /** Callback when saving */
  onSave: (
    documents: TopicDocuments,
    editedBy: string,
    verify: boolean
  ) => Promise<void>;
  /** Callback when canceling */
  onCancel: () => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * Get language hint based on document type
 */
function getLanguageForDocType(docType: DocumentType): string {
  return 'markdown';
}

/**
 * Default empty documents
 */
const DEFAULT_DOCUMENTS: TopicDocuments = {
  conceptual: '',
  technical: '',
  files: '',
  related: '',
};

/**
 * TopicEditor component - Topic create/edit form
 */
export const TopicEditor: React.FC<TopicEditorProps> = ({
  topicName,
  initialDocuments,
  onSave,
  onCancel,
  className = '',
}) => {
  const isCreateMode = !topicName;

  // Document state
  const [documents, setDocuments] = useState<TopicDocuments>(
    initialDocuments || DEFAULT_DOCUMENTS
  );
  const [activeTab, setActiveTab] = useState<DocumentType>('conceptual');
  const [editedBy, setEditedBy] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingWithVerify, setIsSavingWithVerify] = useState(false);

  // Track which documents have been modified
  const [modifiedDocs, setModifiedDocs] = useState<Set<DocumentType>>(
    new Set()
  );

  // Check if any documents have changed
  const hasChanges = useMemo(() => {
    if (!initialDocuments) {
      // In create mode, any non-empty content counts as changes
      return Object.values(documents).some((d) => d.trim() !== '');
    }
    // In edit mode, compare with initial
    return (Object.keys(documents) as DocumentType[]).some(
      (key) => documents[key] !== initialDocuments[key]
    );
  }, [documents, initialDocuments]);

  // Handle document change
  const handleDocumentChange = useCallback(
    (content: string) => {
      setDocuments((prev) => ({
        ...prev,
        [activeTab]: content,
      }));
      setModifiedDocs((prev) => new Set(prev).add(activeTab));
    },
    [activeTab]
  );

  // Handle save action
  const handleSave = async (verify: boolean) => {
    if (!editedBy.trim()) {
      alert('Please enter your name');
      return;
    }

    if (verify) {
      setIsSavingWithVerify(true);
    } else {
      setIsSaving(true);
    }

    try {
      await onSave(documents, editedBy.trim(), verify);
    } finally {
      setIsSaving(false);
      setIsSavingWithVerify(false);
    }
  };

  // Handle cancel with confirmation if there are changes
  const handleCancel = () => {
    if (hasChanges) {
      if (
        !window.confirm(
          'You have unsaved changes. Are you sure you want to cancel?'
        )
      ) {
        return;
      }
    }
    onCancel();
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {isCreateMode ? 'Create New Topic' : `Edit: ${topicName}`}
          </h2>

          {hasChanges && (
            <span className="text-sm text-yellow-600 dark:text-yellow-400">
              Unsaved changes
            </span>
          )}
        </div>

        {/* Edited by input */}
        <div className="flex items-end gap-4">
          <NameInput
            value={editedBy}
            onChange={setEditedBy}
            label="Edited by"
            placeholder="Your name"
            required
            className="w-48"
          />

          {/* Document modification indicators */}
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            {modifiedDocs.size > 0 && (
              <span>
                Modified:{' '}
                {Array.from(modifiedDocs)
                  .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
                  .join(', ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Document tabs */}
      <DocumentTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        conceptualHasDraft={modifiedDocs.has('conceptual')}
        technicalHasDraft={modifiedDocs.has('technical')}
        filesHasDraft={modifiedDocs.has('files')}
        relatedHasDraft={modifiedDocs.has('related')}
        className="flex-shrink-0 bg-white dark:bg-gray-800"
      />

      {/* Editor area */}
      <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900 p-4">
        <CodeMirrorEditor
          value={documents[activeTab]}
          onChange={handleDocumentChange}
          language={getLanguageForDocType(activeTab)}
          placeholder={`Enter ${activeTab} documentation...`}
          showLineNumbers
          minHeight={400}
          className="h-full"
        />
      </div>

      {/* Action footer */}
      <div className="flex-shrink-0 px-6 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {/* Cancel button */}
          <button
            type="button"
            onClick={handleCancel}
            className="
              px-4 py-2
              text-sm font-medium
              text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-md
              hover:bg-gray-50 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500
              transition-colors
            "
          >
            Cancel
          </button>

          <div className="flex-1" />

          {/* Save button */}
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={isSaving || isSavingWithVerify || !editedBy.trim()}
            className="
              inline-flex items-center gap-2
              px-4 py-2
              text-sm font-medium
              text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-md
              hover:bg-gray-50 dark:hover:bg-gray-600
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
              transition-colors
            "
          >
            {isSaving ? (
              <>
                <svg
                  className="animate-spin w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
                Save
              </>
            )}
          </button>

          {/* Save & Verify button */}
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={isSaving || isSavingWithVerify || !editedBy.trim()}
            className="
              inline-flex items-center gap-2
              px-4 py-2
              text-sm font-medium
              text-white
              bg-green-600 hover:bg-green-700
              dark:bg-green-500 dark:hover:bg-green-600
              rounded-md
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
              transition-colors
            "
          >
            {isSavingWithVerify ? (
              <>
                <svg
                  className="animate-spin w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Save & Verify
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TopicEditor;
