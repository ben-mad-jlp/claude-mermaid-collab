import { useState } from 'react';
import { DocumentHistory } from '../types/diff';

export function useDocumentHistory(documentId: string) {
  const [history, setHistory] = useState<DocumentHistory>({
    previous: null,
    current: '',
    hasDiff: false,
  });

  const recordChange = (oldContent: string, newContent: string) => {
    setHistory({
      previous: oldContent,
      current: newContent,
      hasDiff: oldContent !== newContent,
    });
  };

  const clearDiff = () => {
    setHistory((prev) => ({
      ...prev,
      previous: null,
      hasDiff: false,
    }));
  };

  return { history, recordChange, clearDiff };
}
