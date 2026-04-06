/**
 * FunctionJumpPanel Component
 *
 * Right panel (220px) for navigating between functions in a pseudo-code viewer.
 * Features:
 * - Lists all functions with their export status
 * - Highlights active function via IntersectionObserver
 * - Click to scroll to function in viewer
 * - Export indicator (green dot) for exported functions
 */

import React, { useRef, useState, useEffect, RefObject } from 'react';
import { PseudoMethod } from '@/lib/pseudo-api';
import type { PseudoViewerHandle } from './PseudoViewer';

export type FunctionJumpPanelProps = {
  functions: PseudoMethod[];
  viewerRef: RefObject<PseudoViewerHandle>;
};

export default function FunctionJumpPanel(
  props: FunctionJumpPanelProps
): JSX.Element | null {
  const { functions, viewerRef } = props;
  const [activeFunction, setActiveFunction] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Setup IntersectionObserver — runs whenever functions list changes (new file loaded)
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (functions.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let mostIntersecting: IntersectionObserverEntry | null = null;
        let maxRatio = 0;

        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostIntersecting = entry;
          }
        }

        if (mostIntersecting && mostIntersecting.intersectionRatio > 0.3) {
          const functionName = mostIntersecting.target.getAttribute('data-function');
          if (functionName) {
            setActiveFunction(functionName);
          }
        }
      },
      { threshold: 0.3 }
    );

    // Observe all data-function blocks currently in the document
    const elements = document.querySelectorAll('[data-function]');
    elements.forEach((el) => observerRef.current?.observe(el));

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [functions]);

  // Return null if no functions — after all hooks
  if (functions.length === 0) {
    return null;
  }

  const handleFunctionClick = (functionName: string) => {
    if (viewerRef.current) {
      viewerRef.current.scrollToFunction(functionName);
    }
  };

  return (
    <div
      data-testid="function-jump-panel"
      className="w-full h-full border-l overflow-y-auto px-3 py-4"
    >
      {/* Header */}
      <div className="text-[11px] uppercase font-semibold text-stone-600 mb-3">
        FUNCTIONS
      </div>

      {/* Function List */}
      <div className="space-y-2">
        {functions.map((func) => {
          const isActive = activeFunction === func.name;

          return (
            <div
              key={func.name}
              data-function-entry={func.name}
              onClick={() => handleFunctionClick(func.name)}
              className={`cursor-pointer px-2 py-1.5 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-purple-50 text-purple-700 font-semibold'
                  : 'text-stone-700 hover:bg-stone-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate">{func.name}</span>
                {func.isExported && (
                  <div
                    data-export-dot
                    className="w-1.5 h-1.5 rounded-full bg-green-600 flex-shrink-0"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
