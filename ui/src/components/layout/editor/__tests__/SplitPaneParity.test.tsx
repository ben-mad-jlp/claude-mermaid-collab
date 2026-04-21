/**
 * SplitPaneParity — integration test for Wave 6 of the split-pane-unified-ux blueprint.
 *
 * Verifies that for every TabKind (and every artifactType under 'artifact'),
 * PaneContent renders the correct subview when the tab is pinned right.
 *
 * Subviews are mocked to lightweight testid stubs so we can assert routing
 * without pulling in heavy editor/preview dependencies.
 */

import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PaneContent from '../PaneContent';
import { useTabsStore, sessionKey, type TabDescriptor } from '@/stores/tabsStore';
import { useSessionStore } from '@/stores/sessionStore';

// --- Subview mocks ---------------------------------------------------------

vi.mock('@/components/editors/UnifiedEditor', () => ({
  __esModule: true,
  default: ({ item }: any) => (
    <div data-testid="mock-unified-editor" data-item-type={item?.type} data-item-id={item?.id} />
  ),
}));

vi.mock('@/components/editors/DocumentView', () => ({
  __esModule: true,
  default: ({ document }: any) => (
    <div data-testid="mock-document-view" data-doc-id={document?.id} />
  ),
}));

vi.mock('@/components/EmbedViewer', () => ({
  __esModule: true,
  EmbedViewer: ({ embed }: any) => (
    <div data-testid="mock-embed-viewer" data-embed-id={embed?.id} />
  ),
}));

vi.mock('@/components/ImageViewer', () => ({
  __esModule: true,
  ImageViewer: ({ imageId }: any) => (
    <div data-testid="mock-image-viewer" data-image-id={imageId} />
  ),
}));

vi.mock('@/components/task-graph', () => ({
  __esModule: true,
  TaskGraphView: ({ project, session }: any) => (
    <div
      data-testid="mock-task-graph-view"
      data-project={project}
      data-session={session}
    />
  ),
}));

vi.mock('@/pages/pseudo/PseudoViewer', () => ({
  __esModule: true,
  PseudoViewer: ({ path, project }: any) => (
    <div data-testid="mock-pseudo-viewer" data-path={path} data-project={project} />
  ),
}));

vi.mock('@/components/editors/CodeFileView', () => ({
  __esModule: true,
  default: ({ path, project }: any) => (
    <div data-testid="mock-code-file-view" data-path={path} data-project={project} />
  ),
  CodeFileView: ({ path, project }: any) => (
    <div data-testid="mock-code-file-view" data-path={path} data-project={project} />
  ),
}));

// --- Test helpers ----------------------------------------------------------

const PROJECT = '/proj';
const NAME = 'sess';
const KEY = sessionKey(PROJECT, NAME);

function makeTab(overrides: Partial<TabDescriptor> & { id: string; kind: TabDescriptor['kind'] }): TabDescriptor {
  return {
    id: overrides.id,
    kind: overrides.kind,
    artifactType: overrides.artifactType,
    artifactId: overrides.artifactId ?? overrides.id,
    name: overrides.name ?? overrides.id,
    isPreview: false,
    isPinned: false,
    order: 0,
    openedAt: 0,
    ...overrides,
  };
}

function seedSession(artifactStore: Partial<{
  diagrams: any[]; documents: any[]; designs: any[];
  spreadsheets: any[]; snippets: any[]; images: any[]; embeds: any[];
}> = {}) {
  useSessionStore.setState({
    currentSession: { project: PROJECT, name: NAME } as any,
    diagrams: artifactStore.diagrams ?? [],
    documents: artifactStore.documents ?? [],
    designs: artifactStore.designs ?? [],
    spreadsheets: artifactStore.spreadsheets ?? [],
    snippets: artifactStore.snippets ?? [],
    images: artifactStore.images ?? [],
    embeds: artifactStore.embeds ?? [],
  } as any);
}

function seedRightTab(tab: TabDescriptor) {
  useTabsStore.setState({
    bySession: {
      [KEY]: {
        tabs: [tab],
        activeTabId: null,
        rightPaneTabId: tab.id,
        activePaneId: 'left',
      },
    },
  });
}

function renderRightPane(tab: TabDescriptor) {
  return render(
    <PaneContent
      tab={tab}
      editMode={false}
      project={PROJECT}
      session={NAME}
    />
  );
}

// --- Tests -----------------------------------------------------------------

describe('SplitPaneParity — each TabKind renders when pinned right', () => {
  beforeEach(() => {
    useTabsStore.setState({ bySession: {} });
    localStorage.clear();
  });

  it('artifact/diagram → UnifiedEditor', () => {
    const tab = makeTab({ id: 'd1', kind: 'artifact', artifactType: 'diagram' });
    seedSession({ diagrams: [{ id: 'd1', name: 'Diag 1', content: 'graph TD;A-->B;' }] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    const el = getByTestId('mock-unified-editor');
    expect(el.getAttribute('data-item-type')).toBe('diagram');
    expect(el.getAttribute('data-item-id')).toBe('d1');
  });

  it('artifact/document → DocumentView', () => {
    const tab = makeTab({ id: 'doc1', kind: 'artifact', artifactType: 'document' });
    seedSession({ documents: [{ id: 'doc1', name: 'Doc 1', content: '# hi' }] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-document-view').getAttribute('data-doc-id')).toBe('doc1');
  });

  it('artifact/design → UnifiedEditor', () => {
    const tab = makeTab({ id: 'des1', kind: 'artifact', artifactType: 'design' });
    seedSession({ designs: [{ id: 'des1', name: 'Design 1' }] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-unified-editor').getAttribute('data-item-type')).toBe('design');
  });

  it('artifact/spreadsheet → UnifiedEditor', () => {
    const tab = makeTab({ id: 'sh1', kind: 'artifact', artifactType: 'spreadsheet' });
    seedSession({ spreadsheets: [{ id: 'sh1', name: 'Sheet' }] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-unified-editor').getAttribute('data-item-type')).toBe('spreadsheet');
  });

  it('artifact/snippet → UnifiedEditor', () => {
    const tab = makeTab({ id: 'sn1', kind: 'artifact', artifactType: 'snippet' });
    seedSession({ snippets: [{ id: 'sn1', name: 'Snip', content: 'x' } as any] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-unified-editor').getAttribute('data-item-type')).toBe('snippet');
  });

  it('artifact/image → ImageViewer', () => {
    const tab = makeTab({ id: 'img1', kind: 'artifact', artifactType: 'image' });
    seedSession({ images: [{ id: 'img1', name: 'Pic' } as any] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-image-viewer').getAttribute('data-image-id')).toBe('img1');
  });

  it('embed → EmbedViewer', () => {
    const tab = makeTab({ id: 'emb1', kind: 'embed' });
    seedSession({ embeds: [{ id: 'emb1', name: 'Embed' } as any] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-embed-viewer').getAttribute('data-embed-id')).toBe('emb1');
  });

  it('task-graph → TaskGraphView', () => {
    const tab = makeTab({ id: 'tg', kind: 'task-graph' });
    seedSession();
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    const el = getByTestId('mock-task-graph-view');
    expect(el.getAttribute('data-project')).toBe(PROJECT);
    expect(el.getAttribute('data-session')).toBe(NAME);
  });

  it('task-details → placeholder (not yet implemented)', () => {
    const tab = makeTab({ id: 'td1', kind: 'task-details' });
    seedSession();
    seedRightTab(tab);
    const { getByTestId, getByText } = renderRightPane(tab);
    expect(getByTestId('pane-content-not-found')).toBeTruthy();
    expect(getByText(/Task details view not implemented/i)).toBeTruthy();
  });

  it('blueprint → DocumentView', () => {
    const tab = makeTab({ id: 'bp1', kind: 'blueprint' });
    seedSession({ documents: [{ id: 'bp1', name: 'BP', content: '# bp' }] });
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    expect(getByTestId('mock-document-view').getAttribute('data-doc-id')).toBe('bp1');
  });

  it('code-file → CodeFileView', () => {
    const tab = makeTab({
      id: 'src/foo.ts',
      kind: 'code-file',
      artifactId: 'src/foo.ts',
    });
    seedSession();
    seedRightTab(tab);
    const { getByTestId } = renderRightPane(tab);
    const el = getByTestId('mock-code-file-view');
    expect(el.getAttribute('data-path')).toBe('src/foo.ts');
    expect(el.getAttribute('data-project')).toBe(PROJECT);
  });

  it('null tab → EmptyPane fallback', () => {
    const { getByTestId } = render(
      <PaneContent tab={null} editMode={false} project={PROJECT} session={NAME} />
    );
    expect(getByTestId('editor-empty-pane')).toBeTruthy();
  });
});
