import React, { useEffect, useRef } from 'react';
import { DocumentEditorLegacy, type DocumentEditorProps } from './DocumentEditor.legacy';
import { DocumentEditorWysiwyg } from './DocumentEditor.wysiwyg';
import { useFeatureFlags } from '@/config/featureFlags';

export type { DocumentEditorProps } from './DocumentEditor.legacy';

export const DocumentEditor: React.FC<DocumentEditorProps> = (props) => {
  let useWysiwyg = false;
  try {
    useWysiwyg = useFeatureFlags().wysiwygDocumentEditor;
  } catch {
    useWysiwyg = false;
  }

  const loggedRef = useRef(false);
  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    // eslint-disable-next-line no-console
    console.info('[DocumentEditor.router] variant=%s', useWysiwyg ? 'wysiwyg' : 'legacy');
  }, [useWysiwyg]);

  return useWysiwyg
    ? <DocumentEditorWysiwyg {...props} />
    : <DocumentEditorLegacy {...props} />;
};

export default DocumentEditor;
