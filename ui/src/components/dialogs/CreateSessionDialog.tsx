/**
 * Create Session Dialog
 *
 * Prompts user for session name and type when creating a new collab session:
 * - Structured: Guided workflow with brainstorming, design, and implementation phases
 * - Vibe: Freeform mode for creating diagrams, docs, and wireframes
 */

import React, { useState } from 'react';

export type SessionType = 'structured' | 'vibe';

interface CreateSessionDialogProps {
  suggestedName: string;
  onConfirm: (name: string, type: SessionType) => void;
  onClose: () => void;
}

export const CreateSessionDialog: React.FC<CreateSessionDialogProps> = ({
  suggestedName,
  onConfirm,
  onClose,
}) => {
  const [sessionName, setSessionName] = useState(suggestedName);
  const [selectedType, setSelectedType] = useState<SessionType | null>(null);

  const handleConfirm = () => {
    if (sessionName.trim() && selectedType) {
      onConfirm(sessionName.trim(), selectedType);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && sessionName.trim() && selectedType) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const sessionTypes: { id: SessionType; label: string; description: string; icon: React.ReactNode }[] = [
    {
      id: 'structured',
      label: 'Structured',
      description: 'Guided workflow with brainstorming, design, and implementation phases',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      ),
    },
    {
      id: 'vibe',
      label: 'Vibe',
      description: 'Freeform mode for creating diagrams, docs, and wireframes',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Create New Session
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Choose a name and session type
          </p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Session Name Input */}
          <div>
            <label
              htmlFor="session-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Session Name
            </label>
            <input
              id="session-name"
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              autoFocus
              className="
                w-full px-3 py-2
                border border-gray-300 dark:border-gray-600
                rounded-lg
                bg-white dark:bg-gray-700
                text-gray-900 dark:text-white
                focus:ring-2 focus:ring-blue-500 focus:border-transparent
                outline-none
              "
              placeholder="Enter session name"
            />
          </div>

          {/* Session Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Session Type
            </label>
            <div className="space-y-2">
              {sessionTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`
                    w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-colors
                    ${selectedType === type.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                    cursor-pointer
                  `}
                >
                  <div className={`
                    p-2 rounded-lg
                    ${selectedType === type.id
                      ? 'bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }
                  `}>
                    {type.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`
                      font-medium
                      ${selectedType === type.id
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-900 dark:text-white'
                      }
                    `}>
                      {type.label}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {type.description}
                    </div>
                  </div>
                  {selectedType === type.id && (
                    <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sessionName.trim() || !selectedType}
            className={`
              px-4 py-2 text-sm font-medium rounded-lg transition-colors
              ${sessionName.trim() && selectedType
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }
            `}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateSessionDialog;
