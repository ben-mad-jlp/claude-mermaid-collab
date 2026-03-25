/**
 * CallsLink Component
 *
 * Renders a clickable orange link with hover popover showing file content.
 * Features:
 * - Orange link text with underline
 * - 400ms hover delay before showing popover
 * - 300ms grace period after mouse leave
 * - Click to navigate to the referenced file
 * - Fixed-position popover with viewport overflow handling
 */

import React, { useState, useRef, useCallback } from 'react';
import CallsPopover from './CallsPopover';
import { fetchPseudoFile } from '@/lib/pseudo-api';

export type CallsLinkProps = {
  name: string;
  fileStem: string;
  project: string;
  onNavigate: (stem: string) => void;
};

const HOVER_DELAY = 400; // ms before showing popover
const GRACE_PERIOD = 300; // ms before hiding popover after mouse leave

export default function CallsLink({
  name,
  fileStem,
  project,
  onNavigate,
}: CallsLinkProps): JSX.Element {
  const [popoverState, setPopoverState] = useState<{
    visible: boolean;
    anchorRect?: DOMRect;
    content?: string;
  }>({
    visible: false,
  });

  const anchorRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<NodeJS.Timeout | null>(null);
  const graceTimer = useRef<NodeJS.Timeout | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const clearGraceTimer = useCallback(() => {
    if (graceTimer.current) {
      clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearGraceTimer();

    hoverTimer.current = setTimeout(async () => {
      if (anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        // Fetch content then show popover
        let content = '';
        try {
          content = await fetchPseudoFile(project, fileStem);
        } catch {
          // Show popover without content on fetch error
        }
        setPopoverState({
          visible: true,
          anchorRect: rect,
          content,
        });
      }
    }, HOVER_DELAY);
  }, [clearGraceTimer, project, fileStem]);

  const handleMouseLeave = useCallback(() => {
    clearHoverTimer();

    graceTimer.current = setTimeout(() => {
      setPopoverState({
        visible: false,
      });
    }, GRACE_PERIOD);
  }, [clearHoverTimer]);

  const handleClick = useCallback(() => {
    clearHoverTimer();
    clearGraceTimer();
    onNavigate(fileStem);
  }, [fileStem, onNavigate, clearHoverTimer, clearGraceTimer]);

  const handlePopoverMouseEnter = useCallback(() => {
    clearGraceTimer();
  }, [clearGraceTimer]);

  const handlePopoverMouseLeave = useCallback(() => {
    graceTimer.current = setTimeout(() => {
      setPopoverState({ visible: false });
    }, GRACE_PERIOD);
  }, []);

  return (
    <>
      <button
        ref={anchorRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="text-orange-600 underline cursor-pointer text-sm transition-colors hover:text-orange-700"
        data-testid="calls-link"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
        }}
      >
        {name} ({fileStem})
      </button>

      {popoverState.visible && popoverState.anchorRect && (
        <CallsPopover
          fileStem={fileStem}
          content={popoverState.content}
          anchorRect={popoverState.anchorRect}
          visible={popoverState.visible}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        />
      )}
    </>
  );
}
