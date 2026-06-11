# Terminal Error Handling

Error handling patterns for the terminal system, covering tmux operations, PTY management, and WebSocket communication.

## Error Categories

1. **tmux Errors**: Session creation/kill failures, duplicate sessions
2. **PTY Errors**: Shell not found, spawn failures, write errors
3. **WebSocket Errors**: Connection failures, message delivery issues
4. **Storage Errors**: File read/write failures for session state

## Recovery Strategies

- **Duplicate Session**: Silently succeed (session already exists)
- **Session Not Found**: Silently succeed for kill operations
- **Shell Not Found**: Fall back through chain: $SHELL → /bin/zsh → /bin/bash → /bin/sh
- **WebSocket Closed**: Catch and ignore send errors