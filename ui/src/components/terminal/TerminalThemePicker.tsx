import { useQuickReplyStore, type TerminalThemeSetting } from '@/stores/quickReplyStore';
import type { TerminalPalette } from './terminalTheme';

/**
 * TerminalThemePicker — choose the terminal theme: Match (follow the collab app
 * theme) or pin Light / Dark / Sepia. Drives the xterm palette + the chip bar and
 * composer chrome via the shared terminalTheme palette.
 */

const OPTIONS: { value: TerminalThemeSetting; label: string }[] = [
  { value: 'match', label: 'Match collab' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' },
];

export function TerminalThemePicker({ palette, disabled }: { palette: TerminalPalette; disabled?: boolean }) {
  const terminalTheme = useQuickReplyStore((s) => s.terminalTheme);
  const setTerminalTheme = useQuickReplyStore((s) => s.setTerminalTheme);
  return (
    <select
      value={terminalTheme}
      disabled={disabled}
      onChange={(e) => setTerminalTheme(e.target.value as TerminalThemeSetting)}
      title="Terminal theme — Match follows the collab app; or pin Light / Dark / Sepia"
      aria-label="Terminal theme"
      style={{
        marginTop: 2, padding: '2px 4px', fontSize: 11, lineHeight: 1.2,
        cursor: disabled ? 'default' : 'pointer',
        color: palette.mutedFg, background: palette.inputBg,
        border: `1px solid ${palette.border}`, borderRadius: 4, outline: 'none',
      }}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value} style={{ color: '#000' }}>{o.label}</option>
      ))}
    </select>
  );
}

export default TerminalThemePicker;
