# Tmux Integration

The terminal system uses tmux for persistent shell sessions that survive browser disconnects and server restarts.

## Why tmux?

- **Session Persistence**: Processes continue running when browser disconnects
- **Multiple Windows**: Each collab session can have multiple terminal tabs
- **History Preservation**: Command history maintained across reconnects
- **Process Isolation**: Each terminal runs in isolated tmux session

## Session Naming

Format: `mc-<sanitized-session>-<random>`
- `mc-` prefix identifies mermaid-collab sessions
- Session name sanitized (lowercase alphanumeric, max 20 chars)
- Random 4-char suffix for uniqueness

## Configuration

- Mouse scrolling enabled via `set-option mouse on`
- Split keys unbound to prevent pane splitting