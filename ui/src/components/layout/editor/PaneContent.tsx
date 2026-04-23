/**
 * PaneContent — dispatches a TabDescriptor to the correct viewer/editor.
 *
 * Replaces renderPane() in SplitEditorHost, covering every TabKind.
 * sessionStore stores records WITHOUT a `type` discriminator; we stamp it
 * at lookup time to produce an Item.
 *
 * No TaskDetailsView / BlueprintView components exist yet; those fall back
 * to a placeholder with an explanatory message (flagged for follow-up).
 * Blueprints are documents (blueprint flag on metadata) so they render via
 * DocumentView.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import EmptyPane from './EmptyPane';
import UnifiedEditor from '@/components/editors/UnifiedEditor';
import DocumentView from '@/components/editors/DocumentView';
import { EmbedViewer } from '@/components/EmbedViewer';
import { ImageViewer } from '@/components/ImageViewer';
import { TaskGraphView } from '@/components/task-graph';
import { PseudoViewer } from '@/pages/pseudo/PseudoViewer';
import CodeFileView from '@/components/editors/CodeFileView';
import { CodeEditor } from '@/components/editors/CodeEditor';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import type { TabDescriptor } from '@/stores/tabsStore';
import type { Document, Item } from '@/types';

export interface PaneContentProps {
  tab: TabDescriptor | null;
  editMode: boolean;
  project?: string;
  session?: string;
  onContentChange?: (itemId: string, content: string) => void;
  onSnippetToolbarControls?: (controls: React.ReactNode) => void;
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="relative h-full w-full" data-testid="pane-content-not-found">
      <EmptyPane />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <p className="text-sm text-gray-600 dark:text-gray-300 bg-white/70 dark:bg-gray-900/70 px-3 py-1 rounded">
          {message}
        </p>
      </div>
    </div>
  );
}

export const PaneContent: React.FC<PaneContentProps> = ({
  tab,
  editMode,
  project,
  session,
  onContentChange,
  onSnippetToolbarControls,
}) => {
  const {
    diagrams,
    documents,
    designs,
    spreadsheets,
    snippets,
    images,
    embeds,
  } = useSessionStore(
    useShallow((s) => ({
      diagrams: s.diagrams,
      documents: s.documents,
      designs: s.designs,
      spreadsheets: s.spreadsheets,
      snippets: s.snippets,
      images: s.images,
      embeds: s.embeds,
    })),
  );
  const codeFirstView = useUIStore((s) => s.codeFirstView);
  const pairMode = useUIStore((s) => s.pairMode);

  if (!tab) return <EmptyPane />;

  const handleChange = (content: string) => {
    if (tab.artifactId) onContentChange?.(tab.artifactId, content);
  };

  const paneContent = (() => { switch (tab.kind) {
    case 'artifact': {
      const aType = tab.artifactType;
      if (!aType) return <NotFound message="Artifact type missing" />;

      let item: Item | null = null;
      switch (aType) {
        case 'diagram': {
          const d = diagrams.find((x) => x.id === tab.artifactId);
          if (d) item = { ...d, type: 'diagram' } as Item;
          break;
        }
        case 'document': {
          const d = documents.find((x) => x.id === tab.artifactId);
          if (d) item = { ...d, type: 'document' } as Item;
          break;
        }
        case 'design': {
          const d = designs.find((x) => x.id === tab.artifactId);
          if (d) item = { ...d, type: 'design' } as Item;
          break;
        }
        case 'spreadsheet': {
          const d = spreadsheets.find((x) => x.id === tab.artifactId);
          if (d) item = { ...d, type: 'spreadsheet' } as Item;
          break;
        }
        case 'snippet': {
          const d = snippets.find((x) => x.id === tab.artifactId);
          if (d) item = { ...d, type: 'snippet' } as Item;
          break;
        }
        case 'image': {
          const img = images.find((x) => x.id === tab.artifactId);
          if (!img) return <NotFound message="Image not found" />;
          return (
            <ImageViewer
              imageId={tab.artifactId}
              project={project}
              session={session}
            />
          );
        }
        default:
          return <NotFound message="Unknown artifact type" />;
      }

      if (!item) return <NotFound message="Artifact not found" />;

      if (aType === 'document') {
        return (
          <DocumentView
            document={item as unknown as Document}
            onContentChange={handleChange}
          />
        );
      }

      return (
        <UnifiedEditor
          item={item}
          editMode={editMode}
          project={project}
          session={session}
          onContentChange={handleChange}
          onSnippetToolbarControls={onSnippetToolbarControls}
        />
      );
    }

    case 'embed': {
      const embed = embeds.find((e) => e.id === tab.artifactId);
      if (!embed) return <NotFound message="Embed not found" />;
      return <EmbedViewer embed={embed} />;
    }

    case 'task-graph': {
      if (!project || !session) {
        return <NotFound message="Task graph requires an active session" />;
      }
      return <TaskGraphView project={project} session={session} />;
    }

    case 'task-details': {
      return <NotFound message="Task details view not implemented" />;
    }

    case 'blueprint': {
      const doc = documents.find((d) => d.id === tab.artifactId);
      if (!doc) return <NotFound message="Blueprint not found" />;
      const item = { ...doc, type: 'document' } as Item;
      return (
        <DocumentView
          document={item as unknown as Document}
          onContentChange={handleChange}
        />
      );
    }

    case 'code-file': {
      if (!project) {
        return <NotFound message="Code file requires a project" />;
      }
      if (codeFirstView) {
        return (
          <CodeEditor
            filePath={tab.filePath ?? tab.artifactId}
            project={project}
          />
        );
      }
      return <PseudoViewer path={tab.filePath ?? tab.artifactId} project={project} />;
    }

    default:
      return <NotFound message="Unknown tab kind" />;
  } })();

  return (
    <div className={`h-full w-full${pairMode ? ' ring-2 ring-inset ring-amber-400/50' : ''}`}>
      {paneContent}
    </div>
  );
};

export default PaneContent;
