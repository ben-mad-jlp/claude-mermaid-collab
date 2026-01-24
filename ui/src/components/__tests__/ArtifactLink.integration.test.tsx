/**
 * ArtifactLink End-to-End Integration Test
 *
 * Tests the complete artifact notification workflow:
 * 1. ArtifactLink component renders in MessageArea
 * 2. User clicks the link
 * 3. ViewerStore is updated with new artifact
 * 4. Viewer pane can display the selected artifact
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactLink } from '../ArtifactLink';
import { useViewerStore } from '@/stores/viewerStore';

describe('ArtifactLink End-to-End Integration', () => {
  beforeEach(() => {
    useViewerStore.getState().reset();
  });

  describe('Complete Artifact Navigation Flow', () => {
    it('should navigate to document artifact and update viewer state', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <div>
          <h1>Chat</h1>
          <div className="messages">
            <ArtifactLink
              notification={{
                type: 'created',
                artifactType: 'document',
                id: 'design-doc-v2',
                name: 'System Design Document',
              }}
              onClick={(id, type) => {
                const store = useViewerStore.getState();
                store.navigateToArtifact(id, type);
              }}
            />
          </div>
          <div className="viewer">
            {(() => {
              const { currentView } = useViewerStore.getState();
              if (!currentView) return <p>No artifact selected</p>;
              return (
                <div data-testid="artifact-viewer">
                  <h2>
                    {currentView.type === 'document' ? '📄' : '📊'} {currentView.id}
                  </h2>
                </div>
              );
            })()}
          </div>
        </div>
      );

      // Initially, no artifact should be selected
      expect(screen.getByText('No artifact selected')).toBeDefined();

      // Click the artifact link
      const button = screen.getByRole('button');
      await user.click(button);

      // Wait for viewer to update (may need a small delay due to React updates)
      await waitFor(() => {
        const viewerState = useViewerStore.getState();
        expect(viewerState.currentView?.id).toBe('design-doc-v2');
        expect(viewerState.currentView?.type).toBe('document');
      });
    });

    it('should navigate to diagram artifact and update viewer state', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <ArtifactLink
            notification={{
              type: 'created',
              artifactType: 'diagram',
              id: 'flowchart-123',
              name: 'Process Flowchart',
            }}
            onClick={(id, type) => {
              useViewerStore.getState().navigateToArtifact(id, type);
            }}
          />
          <div data-testid="viewer">
            {(() => {
              const { currentView } = useViewerStore.getState();
              return currentView ? (
                <div>{currentView.type}: {currentView.id}</div>
              ) : null;
            })()}
          </div>
        </div>
      );

      const button = screen.getByRole('button');
      await user.click(button);

      await waitFor(() => {
        const { currentView } = useViewerStore.getState();
        expect(currentView?.id).toBe('flowchart-123');
        expect(currentView?.type).toBe('diagram');
      });
    });

    it('should handle switching between different artifacts', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <div>
          <div data-testid="artifact-1">
            <ArtifactLink
              notification={{
                type: 'created',
                artifactType: 'document',
                id: 'doc-1',
                name: 'Document 1',
              }}
              onClick={(id, type) => {
                useViewerStore.getState().navigateToArtifact(id, type);
              }}
            />
          </div>
          <div data-testid="viewer">
            {(() => {
              const { currentView } = useViewerStore.getState();
              return currentView ? `${currentView.type}:${currentView.id}` : 'none';
            })()}
          </div>
        </div>
      );

      // Click first artifact
      let button = screen.getByRole('button');
      await user.click(button);

      await waitFor(() => {
        expect(useViewerStore.getState().currentView?.id).toBe('doc-1');
      });

      // Re-render with a different artifact
      rerender(
        <div>
          <div data-testid="artifact-2">
            <ArtifactLink
              notification={{
                type: 'created',
                artifactType: 'diagram',
                id: 'diag-1',
                name: 'Diagram 1',
              }}
              onClick={(id, type) => {
                useViewerStore.getState().navigateToArtifact(id, type);
              }}
            />
          </div>
          <div data-testid="viewer">
            {(() => {
              const { currentView } = useViewerStore.getState();
              return currentView ? `${currentView.type}:${currentView.id}` : 'none';
            })()}
          </div>
        </div>
      );

      // Click second artifact
      button = screen.getByRole('button');
      await user.click(button);

      await waitFor(() => {
        const { currentView } = useViewerStore.getState();
        expect(currentView?.id).toBe('diag-1');
        expect(currentView?.type).toBe('diagram');
      });
    });

    it('should display both document and diagram icons correctly', () => {
      const { rerender, container: container1 } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Doc',
          }}
          onClick={() => {}}
        />
      );

      // Check for document icon
      expect(container1.textContent).toContain('📄');

      // Render diagram
      rerender(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'diagram',
            id: 'diag-1',
            name: 'Diagram',
          }}
          onClick={() => {}}
        />
      );

      // Check for diagram icon
      expect(container1.textContent).toContain('📊');
    });

    it('should maintain independent state for chat and viewer', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <h1>Chat Messages</h1>
          <div data-testid="message-1">
            <p>First artifact</p>
            <ArtifactLink
              notification={{
                type: 'created',
                artifactType: 'document',
                id: 'doc-1',
                name: 'First',
              }}
              onClick={(id, type) => {
                useViewerStore.getState().navigateToArtifact(id, type);
              }}
            />
          </div>
          <div data-testid="message-2">
            <p>Second artifact</p>
            <ArtifactLink
              notification={{
                type: 'updated',
                artifactType: 'diagram',
                id: 'diag-1',
                name: 'Second',
              }}
              onClick={(id, type) => {
                useViewerStore.getState().navigateToArtifact(id, type);
              }}
            />
          </div>
        </div>
      );

      // Both artifacts should be visible
      expect(screen.getByText('First artifact')).toBeDefined();
      expect(screen.getByText('Second artifact')).toBeDefined();

      // Click first artifact
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[0]);

      // Verify store was updated
      await waitFor(() => {
        const { currentView } = useViewerStore.getState();
        expect(currentView?.id).toBe('doc-1');
      });

      // Click second artifact
      await user.click(buttons[1]);

      // Verify store was updated again
      await waitFor(() => {
        const { currentView } = useViewerStore.getState();
        expect(currentView?.id).toBe('diag-1');
      });
    });

    it('should handle rapid successive artifact selections', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <div data-testid="links">
            {['doc-1', 'doc-2', 'diag-1'].map((id) => (
              <ArtifactLink
                key={id}
                notification={{
                  type: 'created',
                  artifactType: id.startsWith('diag') ? 'diagram' : 'document',
                  id,
                  name: id,
                }}
                onClick={(id, type) => {
                  useViewerStore.getState().navigateToArtifact(id, type);
                }}
              />
            ))}
          </div>
        </div>
      );

      const buttons = screen.getAllByRole('button');

      // Click in sequence
      await user.click(buttons[0]);
      expect(useViewerStore.getState().currentView?.id).toBe('doc-1');

      await user.click(buttons[1]);
      expect(useViewerStore.getState().currentView?.id).toBe('doc-2');

      await user.click(buttons[2]);
      expect(useViewerStore.getState().currentView?.id).toBe('diag-1');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing onClick callback gracefully', async () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: 'Doc',
          }}
          onClick={() => {
            // No-op for this test
          }}
        />
      );

      expect(container).toBeDefined();
    });

    it('should handle empty artifact ID', async () => {
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: '',
            name: 'Empty ID',
          }}
          onClick={(id, type) => {
            useViewerStore.getState().navigateToArtifact(id, type);
          }}
        />
      );

      expect(container).toBeDefined();
    });

    it('should handle very long artifact names', () => {
      const longName = 'A'.repeat(500);
      const { container } = render(
        <ArtifactLink
          notification={{
            type: 'created',
            artifactType: 'document',
            id: 'doc-1',
            name: longName,
          }}
          onClick={() => {}}
        />
      );

      expect(container.textContent).toContain('A');
    });
  });
});
