import { useRef, useEffect, useState } from 'react';
import { useBrowserStore } from '@/stores/browserStore';
import { useUIStore } from '@/stores/uiStore';
import { ResizableColumn } from '@/components/layout/ResizableColumn';

const bridge = () => (window as any).mc?.browser;

/**
 * Multi-tab browser panel. Renders a UI chrome (tab strip + address bar) over
 * a placeholder div whose bounding rect is forwarded to the main process so it
 * can position a native Electron WebContentsView over the exact rectangle.
 */
export function BrowserPanel() {
  const visible = useBrowserStore((s) => s.visible);
  const tabs = useBrowserStore((s) => s.tabs);
  const activeId = useBrowserStore((s) => s.activeId);
  const width = useBrowserStore((s) => s.width);
  const setWidth = useBrowserStore((s) => s.setWidth);
  const openUserTab = useBrowserStore((s) => s.openUserTab);
  const closeTab = useBrowserStore((s) => s.closeTab);
  const activateTab = useBrowserStore((s) => s.activateTab);
  const navigate = useBrowserStore((s) => s.navigate);
  const goBack = useBrowserStore((s) => s.goBack);
  const goForward = useBrowserStore((s) => s.goForward);
  const reload = useBrowserStore((s) => s.reload);
  const toggleDevTools = useBrowserStore((s) => s.toggleDevTools);
  const hide = useBrowserStore((s) => s.hide);
  const refresh = useBrowserStore((s) => s.refresh);
  // When the artifact viewer is hidden, the browser fills the freed space
  // (flex-1) instead of staying a fixed-width resizable column.
  const viewerVisible = useUIStore((s) => s.viewerVisible);

  const activeTab = tabs.find((t) => t.id === activeId);
  const [addressValue, setAddressValue] = useState(activeTab?.url ?? '');

  // Keep address bar in sync with the active tab's url
  useEffect(() => {
    setAddressValue(activeTab?.url ?? '');
  }, [activeId, activeTab?.url]);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Populate tabs on mount/visibility
  useEffect(() => {
    if (visible) {
      refresh();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forward the viewport's bounding rect to the native layer. A native
  // WebContentsView is an OS overlay positioned by absolute viewport coords, so
  // it must track ANY layout change — including position shifts (e.g. the
  // terminal column opening pushes this column left) that a ResizeObserver
  // misses. A rAF loop that only calls setBounds when the rect changes is the
  // robust way to follow the placeholder div.
  const zero = { x: 0, y: 0, width: 0, height: 0 };
  useEffect(() => {
    if (!visible) {
      bridge()?.setBounds?.(zero);
      return;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = viewportRef.current;
      // A native WebContentsView is an OS overlay that paints ABOVE all DOM, so
      // it would cover any modal/overlay (e.g. the subscribe modal). When a
      // full-screen overlay is present, collapse the view to zero so the DOM
      // modal shows through; restore on close.
      const occluded = !!document.querySelector('.fixed.inset-0');
      if (el && !occluded) {
        const r = el.getBoundingClientRect();
        // getBoundingClientRect is in CSS px of the (zoomed) page, but the native
        // WebContentsView's setBounds expects the window's unzoomed DIP space.
        // When the app zoom factor != 1, scale the rect by it — otherwise the
        // native view is mis-sized (e.g. at 90% it spills into the terminal pane).
        const z = (window.mc as any)?.setZoomFactor ? useUIStore.getState().zoomLevel / 100 : 1;
        const rect = {
          x: Math.round(r.x * z),
          y: Math.round(r.y * z),
          width: Math.round(r.width * z),
          height: Math.round(r.height * z),
        };
        const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
        if (key !== last) {
          last = key;
          bridge()?.setBounds?.(rect);
        }
      } else if (occluded && last !== 'occluded') {
        last = 'occluded';
        bridge()?.setBounds?.(zero);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      bridge()?.setBounds?.(zero);
    };
    // Re-run on activeId so a newly-opened/switched tab gets the current column
    // rect pushed immediately (fresh `last` → no dedup skip).
  }, [visible, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const body = (
    <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-gray-900">
        {/* Tab strip */}
        <div className="flex items-center gap-0.5 px-1.5 min-h-[32px] overflow-x-auto bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          {tabs.map((tab) => {
            // Blank/new tabs render over a marker page (data: URL, title
            // "mc-browser-pane:…"); neither makes a sensible tab label.
            const isPlaceholder = (s?: string) => !s || s === 'about:blank' || s.startsWith('data:') || s.startsWith('mc-browser-pane');
            const label =
              tab.kind === 'session'
                ? (tab.session ?? 'Session')
                : (!isPlaceholder(tab.title) ? tab.title : (!isPlaceholder(tab.url) ? tab.url : 'New Tab'));
            const isActive = tab.id === activeId;

            return (
              <div
                key={tab.id}
                onClick={() => activateTab(tab.id)}
                className={`flex items-center gap-1 px-2 py-1 cursor-pointer text-xs border-b-2 flex-1 min-w-0 max-w-[160px] ${
                  isActive
                    ? 'border-blue-500 text-gray-900 dark:text-gray-100'
                    : 'border-transparent text-gray-500 dark:text-gray-400'
                }`}
              >
                <span className="truncate min-w-0 flex-1" title={label}>{label}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  title="Close tab"
                  className="flex-shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-0.5 leading-none text-[11px]"
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* New tab */}
          <button
            type="button"
            onClick={() => openUserTab()}
            title="New tab"
            className="flex-shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 px-2 py-1 text-base leading-none"
          >
            +
          </button>

          <div className="flex-1" />

          {/* Close panel */}
          <button
            type="button"
            onClick={hide}
            title="Close browser"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 px-2 py-1 text-xs"
          >
            ✕
          </button>
        </div>

        {/* Nav controls + address bar */}
        <div className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => activeId && goBack(activeId)}
            disabled={!activeId}
            title="Back"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 px-1 leading-none"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => activeId && goForward(activeId)}
            disabled={!activeId}
            title="Forward"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 px-1 leading-none"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => activeId && reload(activeId)}
            disabled={!activeId}
            title="Reload"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 px-1 leading-none"
          >
            ⟳
          </button>
          <input
            type="text"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && activeId) {
                navigate(activeId, addressValue);
              }
            }}
            placeholder="Enter URL or search…"
            className="flex-1 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-xs outline-none"
          />
          <button
            type="button"
            onClick={() => activeId && toggleDevTools(activeId)}
            disabled={!activeId}
            title="Toggle DevTools for this tab"
            aria-label="Toggle DevTools"
            className="flex-shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 px-1 leading-none"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </button>
        </div>

        {/* Viewport placeholder — native WebContentsView sits over this rect */}
        <div ref={viewportRef} className="flex-1" />
      </div>
  );

  // Viewer hidden → browser fills the freed space. Viewer shown → fixed-width
  // resizable column beside the artifact editor.
  if (!viewerVisible) {
    return <div className="flex flex-1 min-h-0">{body}</div>;
  }
  return (
    <ResizableColumn width={width} onResize={setWidth} min={360}>
      {body}
    </ResizableColumn>
  );
}
