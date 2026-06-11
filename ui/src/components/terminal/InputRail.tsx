import { useEffect, useRef, useState } from 'react';
import {
  useQuickReplyStore,
  DEFAULT_CHIPS,
  type Chip,
} from '@/stores/quickReplyStore';

/**
 * InputRail — the quick-reply chip bar (QR1 + QR2).
 *
 * A ~26px row welded to the bottom of the single persistent console. Each chip is
 * "a key you can tap": tapping sends its text into the live `claude` REPL via the
 * existing tmux-send-keys endpoint (which types the literal text, then Enter after
 * 150ms — so a plain tap is the zero-backend-change default).
 *
 * QR1 shipped DEFAULT_CHIPS only. QR2 adds, on top of the same send mechanism:
 *  - custom chips + persistence (quickReplyStore, localStorage `mc.terminal.chips.v1`)
 *  - inline `+` add (the `+` grows in place into a `label` OR `label = text` input)
 *  - right-click management: custom → Edit / Delete / Compose⇄Send; default → Hide
 *  - drag-reorder of custom chips (defaults stay pinned-left, non-draggable)
 *  - a hidden collapse-to-hairline escape hatch (double-click rail bg / ⌘. when focused)
 *
 * Send semantics (Alt-tap invert + true type-only) land in QR3; here the `compose`
 * flag only drives the visible filled-vs-outlined styling so a chip's behaviour is
 * legible before it's tapped. Safety is mechanism, not friction: a per-chip ~800ms
 * lock with a ✓ flash kills the same-chip double-tap into a live REPL.
 *
 * Reads the one attached session (project, session, serverId) from the single
 * console — no multi-tab "active-tab race". A dead console greys the rail out.
 */

/** Per-chip lock window — kills the rage-double-tap into a live REPL (Grok #4). */
const CHIP_LOCK_MS = 800;

interface InputRailProps {
  project: string;
  session: string;
  serverId: string;
  /** No attached/live console → greyed + non-interactive (no POST). */
  disabled?: boolean;
}

/** Return focus to the xterm pane after a send (Grok #7). */
function focusTerminalPane() {
  const el = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
  el?.focus();
}

/** Parse the inline editor's `label` OR `label = text` syntax. */
function parseChipInput(raw: string): { label: string; text?: string } | null {
  const eq = raw.indexOf('=');
  if (eq === -1) {
    const label = raw.trim();
    return label ? { label } : null;
  }
  const label = raw.slice(0, eq).trim();
  const text = raw.slice(eq + 1).trim();
  if (!label) return null;
  return text && text !== label ? { label, text } : { label };
}

type MenuState = { chip: Chip; isDefault: boolean; x: number; y: number };

export function InputRail({ project, session, serverId, disabled = false }: InputRailProps) {
  const collapsed = useQuickReplyStore((s) => s.collapsed);
  const hiddenDefaults = useQuickReplyStore((s) => s.hiddenDefaults);
  const custom = useQuickReplyStore((s) => s.custom);
  const addChip = useQuickReplyStore((s) => s.addChip);
  const editChip = useQuickReplyStore((s) => s.editChip);
  const deleteChip = useQuickReplyStore((s) => s.deleteChip);
  const moveChip = useQuickReplyStore((s) => s.moveChip);
  const toggleCompose = useQuickReplyStore((s) => s.toggleCompose);
  const hideDefault = useQuickReplyStore((s) => s.hideDefault);
  const toggleCollapsed = useQuickReplyStore((s) => s.toggleCollapsed);

  // Per-chip lock map: a chip is locked for ~800ms after its own tap. Cross-chip
  // taps are independent (a sequence like 1→continue is allowed); only re-tapping
  // the SAME chip within the window is suppressed.
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Inline add/edit editor: null = closed, '' (with editId null) = adding, else editing.
  const [editing, setEditing] = useState<{ id: string | null; value: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  // Outside-click dismiss for the context menu — mirrors the TerminalDrawer
  // new-tab menu's mousedown-to-close pattern.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-chip-menu]')) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const sendChip = (chip: Chip) => {
    if (disabled || locked[chip.id]) return;

    const text = chip.text ?? chip.label;
    const body = { project, session, text };
    const mc = (window as any).mc;
    // Copy resetActiveTerminal's dispatch shape: per-server invoke, fetch fallback.
    if (mc?.invokeOnServer) {
      void mc
        .invokeOnServer(serverId, { path: '/api/ide/tmux-send-keys', method: 'POST', body })
        .catch(() => { /* ignore — a send into a just-closed pane 404s harmlessly */ });
    } else if (typeof fetch !== 'undefined') {
      void fetch('/api/ide/tmux-send-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* ignore */ });
    }

    // Lock this chip + flash ✓ for the window, then release.
    setLocked((m) => ({ ...m, [chip.id]: true }));
    if (timers.current[chip.id]) clearTimeout(timers.current[chip.id]);
    timers.current[chip.id] = setTimeout(() => {
      setLocked((m) => {
        const next = { ...m };
        delete next[chip.id];
        return next;
      });
    }, CHIP_LOCK_MS);

    // Hand focus back to the terminal so typing continues uninterrupted.
    focusTerminalPane();
  };

  const openContextMenu = (e: React.MouseEvent, chip: Chip, isDefault: boolean) => {
    // Right-click manages and NEVER sends (left=send), so it's collision-free.
    e.preventDefault();
    setMenu({ chip, isDefault, x: e.clientX, y: e.clientY });
  };

  const commitEditor = () => {
    if (!editing) return;
    const parsed = parseChipInput(editing.value);
    if (parsed) {
      if (editing.id === null) addChip(parsed);
      else editChip(editing.id, { label: parsed.label, text: parsed.text ?? parsed.label });
    }
    setEditing(null);
  };

  const visibleDefaults = DEFAULT_CHIPS.filter((c) => !hiddenDefaults.includes(c.id));

  // Collapsed: a 4px hairline that re-expands on click. Deliberately no chevron —
  // collapsing is rare; surfacing the control would add the chrome the rail rejects.
  if (collapsed) {
    return (
      <div
        onClick={toggleCollapsed}
        title="Show quick-reply bar"
        style={{
          flex: '0 0 auto', height: 4, cursor: 'pointer',
          borderTop: '1px solid #30363d', background: '#161b22',
        }}
      />
    );
  }

  const renderEditor = (key: string, id: string | null) => (
    <input
      key={key}
      autoFocus
      value={editing?.value ?? ''}
      placeholder="label = text"
      onChange={(e) => setEditing({ id, value: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitEditor(); }
        else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
      }}
      onBlur={() => setEditing(null)}
      style={{
        flex: '0 0 auto', width: 160, padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
        color: '#c9d1d9', background: '#0d1117',
        border: '1px solid #58a6ff', borderRadius: 4, outline: 'none',
      }}
    />
  );

  const renderChip = (chip: Chip, isDefault: boolean) => {
    // Edit grows in place: replace the chip with the inline editor.
    if (editing && editing.id === chip.id) return renderEditor(chip.id, chip.id);
    const isLocked = !!locked[chip.id];
    const compose = !!chip.compose;
    return (
      <button
        key={chip.id}
        type="button"
        draggable={!isDefault && !disabled}
        onDragStart={() => { if (!isDefault) dragId.current = chip.id; }}
        onDragOver={(e) => { if (!isDefault && dragId.current) e.preventDefault(); }}
        onDrop={(e) => {
          if (isDefault || !dragId.current) return;
          e.preventDefault();
          moveChip(dragId.current, chip.id);
          dragId.current = null;
        }}
        disabled={disabled || isLocked}
        onClick={() => sendChip(chip)}
        onContextMenu={(e) => openContextMenu(e, chip, isDefault)}
        title={
          isDefault
            ? `Send "${chip.text ?? chip.label}" · right-click to hide`
            : `${compose ? 'Type' : 'Send'} "${chip.text ?? chip.label}" · right-click to manage`
        }
        style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
          whiteSpace: 'nowrap',
          cursor: disabled || isLocked ? 'default' : 'pointer',
          color: isLocked ? '#3fb950' : compose ? '#8b949e' : isDefault ? '#c9d1d9' : '#e6edf3',
          // Filled = fires; outlined (transparent) + caret = stages-for-edit (compose).
          background: compose ? 'transparent' : '#21262d',
          border: `1px solid ${isLocked ? '#238636' : '#30363d'}`,
          borderRadius: 4,
          opacity: isLocked ? 0.6 : compose ? 0.85 : 1,
          transition: 'color 120ms, border-color 120ms',
        }}
      >
        {isLocked && <span aria-hidden="true">✓</span>}
        <span>{chip.label}</span>
        {compose && !isLocked && <span aria-hidden="true" style={{ opacity: 0.7 }}>›</span>}
      </button>
    );
  };

  return (
    <div
      tabIndex={-1}
      onDoubleClick={(e) => {
        // Double-click the rail background (not a chip/button) collapses it.
        if ((e.target as HTMLElement).closest('button, input')) return;
        toggleCollapsed();
      }}
      onKeyDown={(e) => {
        // ⌘. (or Ctrl+.) when the rail holds focus toggles the collapse hatch.
        if ((e.metaKey || e.ctrlKey) && e.key === '.') {
          e.preventDefault();
          toggleCollapsed();
        }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        flex: '0 0 auto', minHeight: 26,
        padding: '0 6px',
        borderTop: '1px solid #30363d',
        background: '#161b22',
        overflowX: 'auto', flexWrap: 'nowrap',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
      title={disabled ? 'No console attached' : undefined}
    >
      {/* Defaults — pinned left, non-draggable. */}
      {visibleDefaults.map((chip) => renderChip(chip, true))}

      {/* Custom chips — draggable to reorder. */}
      {custom.map((chip) => renderChip(chip, false))}

      {/* Trailing +/editor — grows in place into an inline input. Sticky-right so
          it never scrolls out of reach as chips multiply. */}
      <div style={{ position: 'sticky', right: 0, flex: '0 0 auto', marginLeft: 'auto', background: '#161b22' }}>
        {editing && editing.id === null ? (
          renderEditor('add-editor', null)
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing({ id: null, value: '' })}
            title="Add a custom chip (label or label = text)"
            style={{
              flex: '0 0 auto', padding: '2px 8px', fontSize: 14, lineHeight: 1.2,
              cursor: disabled ? 'default' : 'pointer',
              color: '#8b949e', background: 'transparent',
              border: '1px solid #30363d', borderRadius: 4,
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Right-click management menu — anchored at the cursor, outside-click dismiss. */}
      {menu && (
        <div
          data-chip-menu
          role="menu"
          style={{
            position: 'fixed', top: menu.y, left: menu.x, zIndex: 1000,
            minWidth: 140,
            background: '#161b22', border: '1px solid #30363d',
            borderRadius: 4, padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {menu.isDefault ? (
            <MenuItem
              label="Hide"
              onClick={() => { hideDefault(menu.chip.id); setMenu(null); }}
            />
          ) : (
            <>
              <MenuItem
                label="Edit"
                onClick={() => {
                  const c = menu.chip;
                  const value = c.text && c.text !== c.label ? `${c.label} = ${c.text}` : c.label;
                  setEditing({ id: c.id, value });
                  setMenu(null);
                }}
              />
              <MenuItem
                label={menu.chip.compose ? 'Make Send chip' : 'Make Compose chip'}
                onClick={() => { toggleCompose(menu.chip.id); setMenu(null); }}
              />
              <MenuItem
                label="Delete"
                tone="#f85149"
                onClick={() => { deleteChip(menu.chip.id); setMenu(null); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, tone }: { label: string; onClick: () => void; tone?: string }) {
  return (
    <div
      role="menuitem"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        padding: '4px 8px', cursor: 'pointer', fontSize: 12, borderRadius: 2,
        color: tone ?? '#c9d1d9',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#30363d'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {label}
    </div>
  );
}

export default InputRail;
