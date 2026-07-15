import { useLayoutEffect, useRef, useState } from 'react';
import { useTerminalPalette } from './terminalTheme';

export interface ChipSuggestion { from: string; to: string; start: number; end: number; }

export interface SuggestionChipProps {
  suggestion: ChipSuggestion;
  textarea: HTMLTextAreaElement | null;
  onApply: () => void;
  onDismiss: () => void;
  onAdd: () => void;
}

/**
 * A floating suggestion chip positioned above the textarea caret using mirror-div
 * caret measurement. Non-focus-stealing: uses onMouseDown to prevent blur, never
 * calls focus() itself, buttons are separate from the main affordance.
 */
export function SuggestionChip(props: SuggestionChipProps): JSX.Element | null {
  const { suggestion, textarea, onApply, onDismiss, onAdd } = props;
  const p = useTerminalPalette();
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const mirrorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!textarea) return;

    // Build a hidden mirror div to measure caret position.
    let mirror = mirrorRef.current;
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.boxSizing = 'border-box';
      document.body.appendChild(mirror);
      mirrorRef.current = mirror;
    }

    // Copy textarea styles that affect wrapping.
    const cs = getComputedStyle(textarea);
    const props = [
      'font', 'fontFamily', 'fontSize', 'lineHeight', 'padding', 'border',
      'width', 'whiteSpace', 'wordWrap', 'boxSizing',
    ];
    props.forEach((prop) => {
      (mirror.style as any)[prop] = cs.getPropertyValue(prop);
    });

    // Set mirror text to the substring up to the caret.
    mirror.textContent = textarea.value.slice(0, suggestion.end);

    // Append a marker to read its position.
    const marker = document.createElement('span');
    marker.textContent = '';
    mirror.appendChild(marker);

    // Read the marker's position relative to the mirror.
    const markerLeft = marker.offsetLeft;
    const markerTop = marker.offsetTop;
    mirror.removeChild(marker);

    // Compute the chip position: textarea's offset + mirror position - scroll.
    const taRect = textarea.getBoundingClientRect();
    const windowScrollY = window.scrollY || 0;
    const windowScrollX = window.scrollX || 0;

    const left = taRect.left + windowScrollX + markerLeft - (textarea.scrollLeft || 0);
    const top =
      taRect.top + windowScrollY + markerTop - (textarea.scrollTop || 0) - 30; // 30px above the caret

    setPos({ left, top });
  }, [suggestion.end, textarea]);

  if (!textarea) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        zIndex: 25,
        pointerEvents: 'auto',
        fontSize: 12,
        lineHeight: 1.3,
        color: p.fg,
        background: p.surface,
        border: `1px solid ${p.accent}`,
        borderRadius: 6,
        padding: '6px 8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {suggestion.from} → {suggestion.to}
      </div>
      <div
        style={{
          fontSize: 11,
          color: p.mutedFg,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onClick={onApply}
      >
        <span>[Tab] apply</span>
        <span>·</span>
        <span>[Esc] dismiss</span>
        <span>·</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAdd();
          }}
          onMouseDown={(e) => e.preventDefault()}
          title="Add to personal dictionary"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: p.accent,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          [+] add to dict
        </button>
      </div>
    </div>
  );
}

export default SuggestionChip;
