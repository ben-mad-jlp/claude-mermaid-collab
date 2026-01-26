/**
 * AnnotationComponents
 *
 * React components for rendering annotation markers in markdown preview.
 * These components provide visual styling for comments, proposals,
 * approvals, and rejections parsed by the remarkAnnotations plugin.
 */

import React from 'react';
import { AnnotationType } from '@/lib/remarkAnnotations';

/**
 * Props for annotation components
 */
export interface AnnotationProps {
  /** Annotation type determines styling */
  type: AnnotationType;
  /** Text content (comment text or reject reason) */
  text?: string;
  /** Child content for inline annotations */
  children?: React.ReactNode;
}

/**
 * CommentAnnotation Component
 *
 * Renders comment annotations in two modes:
 * - Inline: Highlights text with a tooltip showing the comment
 * - Block: Shows a blue-styled note block
 */
export const CommentAnnotation: React.FC<AnnotationProps> = ({ text, children }) => {
  if (children) {
    // Inline comment - highlight with tooltip
    return (
      <span
        className="bg-blue-100 dark:bg-blue-900/30 border-b-2 border-blue-400"
        title={text}
      >
        {children}
        <span className="text-blue-500 text-xs ml-1">[comment]</span>
      </span>
    );
  } else {
    // Block comment - show as note
    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-3 my-2">
        <span className="text-blue-600 dark:text-blue-300 text-sm">
          {'\u{1F4AC}'} {text}
        </span>
      </div>
    );
  }
};

/**
 * ProposeAnnotation Component
 *
 * Renders proposed content with yellow styling and "PROPOSED" label.
 */
export const ProposeAnnotation: React.FC<AnnotationProps> = ({ children }) => {
  const wrapperClasses = 'bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400';
  const labelClasses = 'text-yellow-600 dark:text-yellow-400 text-xs font-semibold';

  return (
    <div className={`${wrapperClasses} p-3 my-2`}>
      <span className={labelClasses}>PROPOSED</span>
      <div className="mt-1">{children}</div>
    </div>
  );
};

/**
 * ApproveAnnotation Component
 *
 * Renders approved content with green styling and "APPROVED" label.
 */
export const ApproveAnnotation: React.FC<AnnotationProps> = ({ children }) => {
  const wrapperClasses = 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400';
  const labelClasses = 'text-green-600 dark:text-green-400 text-xs font-semibold';

  return (
    <div className={`${wrapperClasses} p-3 my-2`}>
      <span className={labelClasses}>APPROVED</span>
      <div className="mt-1">{children}</div>
    </div>
  );
};

/**
 * RejectAnnotation Component
 *
 * Renders rejected content with red styling, "REJECTED" label,
 * optional rejection reason, and strikethrough content.
 */
export const RejectAnnotation: React.FC<AnnotationProps> = ({ text, children }) => {
  const wrapperClasses = 'bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400';
  const labelClasses = 'text-red-600 dark:text-red-400 text-xs font-semibold';

  return (
    <div className={`${wrapperClasses} p-3 my-2`}>
      <span className={labelClasses}>REJECTED</span>
      {text && <span className="text-red-500 text-sm ml-2">({text})</span>}
      <div className="mt-1 line-through opacity-60">{children}</div>
    </div>
  );
};

/**
 * AnnotationRenderer Component
 *
 * Dispatches to the appropriate annotation component based on type.
 * This is the main entry point for rendering annotations.
 */
export const AnnotationRenderer: React.FC<AnnotationProps> = ({ type, text, children }) => {
  switch (type) {
    case 'comment':
    case 'comment-inline':
      return <CommentAnnotation type={type} text={text}>{children}</CommentAnnotation>;
    case 'propose':
      return <ProposeAnnotation type={type}>{children}</ProposeAnnotation>;
    case 'approve':
      return <ApproveAnnotation type={type}>{children}</ApproveAnnotation>;
    case 'reject':
      return <RejectAnnotation type={type} text={text}>{children}</RejectAnnotation>;
    default:
      return <>{children}</>;
  }
};
