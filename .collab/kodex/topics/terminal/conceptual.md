# Terminal

The terminal system provides integrated shell access within collab sessions. It uses tmux for session persistence and PTY for real-time terminal emulation.

## Architecture

- **tmux sessions**: Long-running shell sessions that persist across browser reconnects
- **PTY Manager**: In-memory Bun native terminal API for process management
- **WebSocket**: Real-time output streaming to browser
- **xterm.js**: Terminal rendering in the React UI

## Features

- Multiple terminal tabs per collab session
- Session persistence via tmux
- Output buffering with RingBuffer for history replay
- Automatic session reconciliation on startup
- Mouse scrolling support
- Terminal split prevention (unbinds tmux split keys)