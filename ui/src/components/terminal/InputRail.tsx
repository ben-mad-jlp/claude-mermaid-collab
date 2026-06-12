import { useEffect, useRef, useState } from 'react';
import {
  useQuickReplyStore,
  DEFAULT_CHIPS,
  type Chip,
} from '@/stores/quickReplyStore';
import { useTerminalPalette, type TerminalPalette } from './terminalTheme';

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
  const p = useTerminalPalette();

  // Per-chip lock map: a chip is locked for ~800ms after its own tap. Cross-chip
  // taps are independent (a sequence like 1→continue is allowed); only re-tapping
  // the SAME chip within the window is suppressed.
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Inline add/edit editor: null = closed, id null = adding, else editing. `compose`
  // is the create-time Send⇄Compose choice (design §3c) — set on the add/edit form.
  const [editing, setEditing] = useState<{ id: string | null; value: string; compose: boolean } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dragId = useRef<string | null>(null);

  // Roving-focus index across the rail's chips (a11y toolbar pattern). The chip
  // at focusedIdx is the single tab stop (tabIndex 0); arrows move between chips.
  const [focusedIdx, setFocusedIdx] = useState(0);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  // Send a chip. A filled (send) chip submits (Enter); an outlined (compose) chip
  // types-only (submit:false). Alt/⌥-tap INVERTS that default on ANY chip — the
  // universal override (design §3a, Grok §7). The backend skips the trailing
  // Enter when submit===false (QR3 route flag).
  const sendChip = (chip: Chip, altKey = false) => {
    if (disabled || locked[chip.id]) return;

    const composeDefault = !!chip.compose;          // outlined chips stage-for-edit
    const submit = altKey ? composeDefault : !composeDefault;

    const text = chip.text ?? chip.label;
    // quiet:true — a user tapping their own quick-reply is not a supervisor nudge,
    // so suppress the nudge toast (mirrors the composer).
    const body = { project, session, text, submit, quiet: true };
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
      if (editing.id === null) addChip({ ...parsed, compose: editing.compose });
      else editChip(editing.id, { label: parsed.label, text: parsed.text ?? parsed.label, compose: editing.compose });
    }
    setEditing(null);
  };

  const visibleDefaults = DEFAULT_CHIPS.filter((c) => !hiddenDefaults.includes(c.id));
  // Flat, ordered chip list (defaults pinned-left, then custom) — the roving-focus
  // and scoped-key model index into this.
  const orderedChips = [...visibleDefaults, ...custom];
  // Clamp the roving index so exactly one chip stays a tab stop even after chips
  // are deleted/hidden (a stale out-of-range index would orphan the toolbar).
  const safeFocused = orderedChips.length ? Math.min(focusedIdx, orderedChips.length - 1) : 0;

  // GLOBAL Ctrl+F1..F12 → fire the auto-response (chip) at that position, from
  // anywhere in collab (plain F1 is the composer-focus shortcut — Ctrl distinguishes
  // them). The window listener is bound once; refs keep it reading the latest chips
  // + send fn without re-binding each render.
  const sendChipRef = useRef(sendChip); sendChipRef.current = sendChip;
  const orderedChipsRef = useRef(orderedChips); orderedChipsRef.current = orderedChips;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const m = /^F(\d{1,2})$/.exec(e.key);
      if (!m) return;
      const chip = orderedChipsRef.current[parseInt(m[1], 10) - 1];
      if (!chip || disabledRef.current) return;
      e.preventDefault();
      sendChipRef.current(chip);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusChipAt = (idx: number) => {
    const n = orderedChips.length;
    if (n === 0) return;
    const next = ((idx % n) + n) % n;
    setFocusedIdx(next);
    chipRefs.current[next]?.focus();
  };

  // Keyboard model for the rail. SCOPED to the rail's own focus — this handler
  // only fires when focus is inside the rail, so the xterm pane's keystrokes are
  // never touched (no global bind). Arrows rove between chips; number/y/n trigger
  // their chip; ⌘./Ctrl+. toggles the collapse hatch.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault();
      toggleCollapsed();
      return;
    }
    // Don't hijack the inline add/edit input.
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (e.key === 'ArrowRight') { e.preventDefault(); focusChipAt(focusedIdx + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focusChipAt(focusedIdx - 1); return; }
    if (e.key === 'Home') { e.preventDefault(); focusChipAt(0); return; }
    if (e.key === 'End') { e.preventDefault(); focusChipAt(orderedChips.length - 1); return; }

    const k = e.key.toLowerCase();
    let target: Chip | undefined;
    if (/^[1-9]$/.test(k)) target = orderedChips.find((c) => c.label === k);
    else if (k === 'y') target = orderedChips.find((c) => c.id === 'yes');
    else if (k === 'n') target = orderedChips.find((c) => c.id === 'no');
    if (target) {
      e.preventDefault();
      sendChip(target, e.altKey);
    }
  };

  // Collapsed: a 4px hairline that re-expands on click. Deliberately no chevron —
  // collapsing is rare; surfacing the control would add the chrome the rail rejects.
  if (collapsed) {
    return (
      <div
        onClick={toggleCollapsed}
        title="Show quick-reply bar"
        style={{
          flex: '0 0 auto', height: 4, cursor: 'pointer',
          borderTop: `1px solid `, background: p.surface,
        }}
      />
    );
  }

  const renderEditor = (key: string, id: string | null) => {
    const compose = editing?.compose ?? false;
    return (
      <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
        <input
          autoFocus
          value={editing?.value ?? ''}
          placeholder="label = text"
          onChange={(e) => setEditing({ id, value: e.target.value, compose })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEditor(); }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
          }}
          // Blur cancels — but a mousedown on the toggle (which preventDefaults)
          // doesn't blur the input, so the toggle can flip without closing.
          onBlur={() => setEditing(null)}
          style={{
            flex: '0 0 auto', width: 160, padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
            color: p.fg, background: p.inputBg,
            border: `1px solid `, borderRadius: 4, outline: 'none',
          }}
        />
        {/* Create-time Send⇄Compose toggle (design §3c). */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setEditing({ id, value: editing?.value ?? '', compose: !compose }); }}
          title={compose ? 'Compose chip (types, no Enter) — click for Send' : 'Send chip (submits) — click for Compose'}
          aria-label={compose ? 'compose chip, switch to send' : 'send chip, switch to compose'}
          style={{
            flex: '0 0 auto', padding: '2px 6px', fontSize: 11, lineHeight: 1.4, cursor: 'pointer',
            color: compose ? p.accentSoft : p.fg,
            background: compose ? 'transparent' : p.chipBg,
            border: `1px solid ${compose ? p.accentSoft : p.border}`, borderRadius: 4,
          }}
        >
          {compose ? 'compose ›' : 'send'}
        </button>
      </span>
    );
  };

  const renderChip = (chip: Chip, isDefault: boolean, idx: number) => {
    // Edit grows in place: replace the chip with the inline editor.
    if (editing && editing.id === chip.id) return renderEditor(chip.id, chip.id);
    const isLocked = !!locked[chip.id];
    const compose = !!chip.compose;
    const verb = compose ? 'Type' : 'Send';
    const payload = chip.text ?? chip.label;
    return (
      <button
        key={chip.id}
        ref={(el) => { chipRefs.current[idx] = el; }}
        type="button"
        // Roving focus: only the focused chip is a tab stop; arrows move between.
        tabIndex={idx === safeFocused ? 0 : -1}
        onFocus={() => setFocusedIdx(idx)}
        aria-label={`${verb.toLowerCase()} ${chip.label}`}
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
        onClick={(e) => sendChip(chip, e.altKey)}
        onContextMenu={(e) => openContextMenu(e, chip, isDefault)}
        title={
          // Advertise send-vs-type + the ⌥ override (design §3a / §4.3).
          `${verb} "${payload}" · ⌥-click to ${compose ? 'send' : 'type only'}` +
          (isDefault ? ' · right-click to hide' : ' · right-click to manage')
        }
        style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
          whiteSpace: 'nowrap',
          cursor: disabled || isLocked ? 'default' : 'pointer',
          // Compose chips: hue-shifted (violet) text + outline, not border-weight
          // alone (Grok §3) — you SEE it stages-for-edit before tapping.
          color: isLocked ? p.success : compose ? p.accentSoft : isDefault ? p.fg : p.fg,
          // Filled = fires; transparent + caret = stages-for-edit (compose).
          background: compose ? 'transparent' : p.chipBg,
          border: `1px solid ${isLocked ? p.successBorder : compose ? p.accentSoft : p.border}`,
          borderRadius: 4,
          opacity: isLocked ? 0.6 : compose ? 0.8 : 1,
          transition: 'color 120ms, border-color 120ms',
        }}
      >
        {isLocked && <span aria-hidden="true">✓</span>}
        <span>{chip.label}</span>
        {/* Ctrl+F# auto-response shortcut for the first 12 chips. */}
        {idx < 12 && (
          <span aria-hidden="true" style={{ opacity: 0.5, fontSize: 10, marginLeft: 1 }}>⌃F{idx + 1}</span>
        )}
        {compose && !isLocked && <span aria-hidden="true" style={{ opacity: 0.7 }}>›</span>}
      </button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label="Quick replies"
      aria-orientation="horizontal"
      onDoubleClick={(e) => {
        // Double-click the rail background (not a chip/button) collapses it.
        if ((e.target as HTMLElement).closest('button, input')) return;
        toggleCollapsed();
      }}
      onKeyDown={onRailKeyDown}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        flex: '0 0 auto', minHeight: 26,
        padding: '3px 6px',
        borderTop: `1px solid `,
        background: p.surface,
        // Wrap chips onto additional rows when the rail is too narrow to fit them
        // on one line (the rail grows taller instead of scrolling sideways).
        flexWrap: 'wrap',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
      title={disabled ? 'No console attached' : undefined}
    >
      {/* Defaults — pinned left, non-draggable. Then custom chips (draggable to
          reorder). Index is the flat position for roving focus + scoped keys. */}
      {visibleDefaults.map((chip, i) => renderChip(chip, true, i))}
      {custom.map((chip, i) => renderChip(chip, false, visibleDefaults.length + i))}

      {/* Trailing +/editor — grows in place into an inline input. marginLeft:auto
          keeps it at the right end of the last row as chips wrap. */}
      <div style={{ flex: '0 0 auto', marginLeft: 'auto', background: p.surface }}>
        {editing && editing.id === null ? (
          renderEditor('add-editor', null)
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing({ id: null, value: '', compose: false })}
            title="Add a custom chip (label or label = text)"
            style={{
              flex: '0 0 auto', padding: '2px 8px', fontSize: 14, lineHeight: 1.2,
              cursor: disabled ? 'default' : 'pointer',
              color: p.mutedFg, background: 'transparent',
              border: `1px solid `, borderRadius: 4,
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
            background: p.surface, border: `1px solid `,
            borderRadius: 4, padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {menu.isDefault ? (
            <MenuItem
              label="Hide"
              palette={p}
              onClick={() => { hideDefault(menu.chip.id); setMenu(null); }}
            />
          ) : (
            <>
              <MenuItem
                label="Edit"
                palette={p}
                onClick={() => {
                  const c = menu.chip;
                  const value = c.text && c.text !== c.label ? `${c.label} = ${c.text}` : c.label;
                  setEditing({ id: c.id, value, compose: !!c.compose });
                  setMenu(null);
                }}
              />
              <MenuItem
                label={menu.chip.compose ? 'Make Send chip' : 'Make Compose chip'}
                palette={p}
                onClick={() => { toggleCompose(menu.chip.id); setMenu(null); }}
              />
              <MenuItem
                label="Delete"
                palette={p}
                tone={p.danger}
                onClick={() => { deleteChip(menu.chip.id); setMenu(null); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, palette, tone }: { label: string; onClick: () => void; palette: TerminalPalette; tone?: string }) {
  return (
    <div
      role="menuitem"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        padding: '4px 8px', cursor: 'pointer', fontSize: 12, borderRadius: 2,
        color: tone ?? palette.fg,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = palette.chipBg; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {label}
    </div>
  );
}

export default InputRail;
