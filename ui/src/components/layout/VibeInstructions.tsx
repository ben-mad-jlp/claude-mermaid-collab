import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useTabsStore } from '@/stores/tabsStore';
import { useDataLoader } from '@/hooks/useDataLoader';

interface VibeInstructionsProps {
  vsCodeMode?: boolean;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function VibeInstructions({ vsCodeMode }: VibeInstructionsProps) {
  const { documents, currentSession } = useSessionStore(
    useShallow((s) => ({ documents: s.documents, currentSession: s.currentSession }))
  );
  const openPreview = useTabsStore((s) => s.openPreview);
  const { selectDocumentWithContent } = useDataLoader();

  const doc = documents.find((d) => d.name.endsWith('vibeinstructions'));

  if (!doc || !currentSession) return null;

  const preview = stripMarkdown(doc.content ?? '').slice(0, 200);

  function handleClick() {
    if (!doc || !currentSession) return;
    if (vsCodeMode) {
      window.parent.postMessage({ type: 'openArtifact', id: doc.id, artifactType: 'documents' }, '*');
    } else {
      openPreview({
        id: doc.id,
        kind: 'artifact',
        artifactType: 'document',
        artifactId: doc.id,
        name: doc.name,
      });
      selectDocumentWithContent(currentSession.project, currentSession.name, doc.id);
    }
  }

  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Vibe Instructions</div>
      <button
        onClick={handleClick}
        className="w-full text-xs text-left text-gray-700 dark:text-gray-300 line-clamp-4"
      >
        {preview}
      </button>
    </div>
  );
}
