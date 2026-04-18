import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../DocumentEditor.legacy', () => ({
  DocumentEditorLegacy: (props: { documentId?: string }) => (
    <div data-testid="legacy-editor" data-doc-id={props.documentId ?? ''} />
  ),
}));

vi.mock('../DocumentEditor.wysiwyg', () => ({
  DocumentEditorWysiwyg: (props: { documentId?: string }) => (
    <div data-testid="wysiwyg-editor" data-doc-id={props.documentId ?? ''} />
  ),
}));

vi.mock('@/config/featureFlags', () => ({
  useFeatureFlags: vi.fn(() => ({ wysiwygDocumentEditor: false })),
}));

import { useFeatureFlags } from '@/config/featureFlags';
import { DocumentEditor } from '../DocumentEditor';

describe('DocumentEditor router', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(useFeatureFlags).mockReturnValue({ wysiwygDocumentEditor: false } as ReturnType<typeof useFeatureFlags>);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders legacy editor when wysiwygDocumentEditor flag is off', () => {
    render(<DocumentEditor documentId="doc-1" />);
    expect(screen.getByTestId('legacy-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('wysiwyg-editor')).toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(expect.any(String), 'legacy');
  });

  it('renders wysiwyg editor when flag is on', () => {
    vi.mocked(useFeatureFlags).mockReturnValue({ wysiwygDocumentEditor: true } as ReturnType<typeof useFeatureFlags>);
    render(<DocumentEditor documentId="doc-1" />);
    expect(screen.getByTestId('wysiwyg-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-editor')).toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(expect.any(String), 'wysiwyg');
  });

  it('forwards props to the chosen variant', () => {
    vi.mocked(useFeatureFlags).mockReturnValue({ wysiwygDocumentEditor: true } as ReturnType<typeof useFeatureFlags>);
    render(<DocumentEditor documentId="abc" />);
    expect(screen.getByTestId('wysiwyg-editor').getAttribute('data-doc-id')).toBe('abc');
  });

  it('falls back to legacy when useFeatureFlags throws', () => {
    vi.mocked(useFeatureFlags).mockImplementation(() => {
      throw new Error('SSR no window');
    });
    render(<DocumentEditor documentId="doc-1" />);
    expect(screen.getByTestId('legacy-editor')).toBeInTheDocument();
    expect(infoSpy).toHaveBeenCalledWith(expect.any(String), 'legacy');
  });

  it('emits telemetry only once per mount via useRef dedupe', () => {
    vi.mocked(useFeatureFlags).mockReturnValue({ wysiwygDocumentEditor: true } as ReturnType<typeof useFeatureFlags>);
    const { rerender } = render(<DocumentEditor documentId="doc-1" />);
    rerender(<DocumentEditor documentId="doc-1" />);
    rerender(<DocumentEditor documentId="doc-1" />);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});
