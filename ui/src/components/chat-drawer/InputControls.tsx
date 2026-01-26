/**
 * InputControls Component
 *
 * Provides input controls with clear and send buttons
 * Layout: [Clear Button] [Input Field] [Send Button]
 */

import React, { useRef, useState } from 'react';

export interface InputControlsProps {
  /** Callback when send button is clicked or Enter is pressed */
  onSend: (message: string) => void;
  /** Callback when clear button is clicked */
  onClear: () => void;
  /** Whether the input/send controls are disabled */
  disabled?: boolean;
  /** Whether the clear button is disabled (defaults to disabled prop) */
  clearDisabled?: boolean;
}

export const InputControls: React.FC<InputControlsProps> = ({
  onSend,
  onClear,
  disabled = false,
  clearDisabled,
}) => {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    onSend(inputValue.trim());
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleClear = () => {
    onClear();
  };

  return (
    <div className="flex gap-2 items-end">
      {/* Clear Button - Left */}
      <button
        onClick={handleClear}
        disabled={clearDisabled ?? disabled}
        aria-label="Clear message area"
        className="
          flex-shrink-0
          px-3 py-2 text-sm font-medium
          text-gray-600 dark:text-gray-400
          bg-gray-100 dark:bg-gray-700
          hover:bg-gray-200 dark:hover:bg-gray-600
          rounded-lg transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Input Field - Middle */}
      <textarea
        ref={textareaRef}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Type your message..."
        disabled={disabled}
        rows={1}
        style={{ minHeight: '38px' }}
        className="
          flex-1
          px-3 py-2 text-sm
          border border-gray-300 dark:border-gray-600 rounded-lg
          bg-white dark:bg-gray-700
          text-gray-900 dark:text-white
          placeholder-gray-400 dark:placeholder-gray-500
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          resize-none overflow-hidden
        "
      />

      {/* Send Button - Right */}
      <button
        onClick={handleSend}
        disabled={disabled || !inputValue.trim()}
        aria-label="Send message"
        className="
          flex-shrink-0
          px-4 py-2 text-sm font-medium
          bg-blue-600 hover:bg-blue-700 text-white
          rounded-lg transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        Send
      </button>
    </div>
  );
};

InputControls.displayName = 'InputControls';
