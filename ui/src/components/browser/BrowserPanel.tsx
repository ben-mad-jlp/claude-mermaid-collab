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
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <ResizableColumn width={width} onResize={setWidth} min={360}>
      <div className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-900">
      {/* Tab strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 6px', borderBottom: '1px solid #30363d',
          background: '#161b22', minHeight: 32, overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const label =
            tab.kind === 'session'
              ? (tab.session ?? 'Session')
              : (tab.title || tab.url || 'New Tab');
          const isActive = tab.id === activeId;

          return (
            <div
              key={tab.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', cursor: 'pointer', fontSize: 12,
                borderBottom: isActive ? '2px solid #58a6ff' : '2px solid transparent',
                color: isActive ? '#c9d1d9' : '#6e7681',
                whiteSpace: 'nowrap',
              }}
              onClick={() => activateTab(tab.id)}
            >
              <span>{label}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                title="Close tab"
                style={{
                  cursor: 'pointer', color: '#6e7681', background: 'none',
                  border: 'none', padding: '0 2px', fontSize: 11, lineHeight: 1,
                }}
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
          style={{
            cursor: 'pointer', color: '#6e7681', background: 'none',
            border: 'none', padding: '4px 8px', fontSize: 16, lineHeight: 1,
          }}
        >
          +
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Close panel */}
        <button
          type="button"
          onClick={hide}
          title="Close browser"
          style={{
            cursor: 'pointer', color: '#6e7681', background: 'none',
            border: 'none', padding: '4px 8px', fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>

      {/* Address bar */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          padding: '4px 8px', background: '#0d1117',
          borderBottom: '1px solid #30363d',
        }}
      >
        <input
          type="text"
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && activeId) {
              navigate(activeId, addressValue);
            }
          }}
          placeholder="Enter URL…"
          style={{
            flex: 1, background: '#161b22', color: '#c9d1d9',
            border: '1px solid #30363d', borderRadius: 4,
            padding: '3px 8px', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* Viewport placeholder — native WebContentsView sits over this rect */}
      <div ref={viewportRef} className="flex-1" />
      </div>
    </ResizableColumn>
  );
}
