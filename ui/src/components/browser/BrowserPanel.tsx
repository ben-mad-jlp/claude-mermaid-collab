import { useRef, useEffect, useState } from 'react';
import { useBrowserStore } from '@/stores/browserStore';
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
  const hide = useBrowserStore((s) => s.hide);
  const refresh = useBrowserStore((s) => s.refresh);

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
      if (el) {
        const r = el.getBoundingClientRect();
        const rect = {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
        const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
        if (key !== last) {
          last = key;
          bridge()?.setBounds?.(rect);
        }
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

  return (
    <ResizableColumn width={width} onResize={setWidth} min={360}>
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-gray-900">
        {/* Tab strip */}
        <div className="flex items-center gap-0.5 px-1.5 min-h-[32px] overflow-x-auto bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          {tabs.map((tab) => {
            const label =
              tab.kind === 'session'
                ? (tab.session ?? 'Session')
                : (tab.title || tab.url || 'New Tab');
            const isActive = tab.id === activeId;

            return (
              <div
                key={tab.id}
                onClick={() => activateTab(tab.id)}
                className={`flex items-center gap-1 px-2 py-1 cursor-pointer text-xs whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-blue-500 text-gray-900 dark:text-gray-100'
                    : 'border-transparent text-gray-500 dark:text-gray-400'
                }`}
              >
                <span className="truncate" style={{ maxWidth: 120 }} title={label}>{label}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  title="Close tab"
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-0.5 leading-none text-[11px]"
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
            className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 px-2 py-1 text-base leading-none"
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
        </div>

        {/* Viewport placeholder — native WebContentsView sits over this rect */}
        <div ref={viewportRef} className="flex-1" />
      </div>
    </ResizableColumn>
  );
}
