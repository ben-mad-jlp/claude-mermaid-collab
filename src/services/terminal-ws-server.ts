/**
 * WebSocket Terminal Server using Bun's native PTY support
 *
 * Provides terminal connections using Bun.spawn with terminal option.
 * Connects to tmux sessions and forwards data over WebSocket.
 *
 * @see https://bun.sh/docs/api/spawn - Terminal (PTY) support section
 */

import type { ServerWebSocket, Subprocess, Terminal } from 'bun';

// Message types for client-server communication
interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface DataMessage {
  type: 'data';
  data: string;
}

type TerminalMessage = ResizeMessage | DataMessage;

// Store active terminal sessions
interface ActiveTerminal {
  process: Subprocess<'ignore', 'ignore', 'ignore'>;
  terminal: Terminal;
  tmuxSession: string;
}

const activeTerminals = new Map<ServerWebSocket<unknown>, ActiveTerminal>();

/**
 * Parse incoming WebSocket message
 */
function parseMessage(data: string | Buffer): TerminalMessage | null {
  try {
    const str = typeof data === 'string' ? data : data.toString('utf-8');
    const parsed = JSON.parse(str);

    if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
      return parsed as ResizeMessage;
    }

    if (parsed.type === 'data' && typeof parsed.data === 'string') {
      return parsed as DataMessage;
    }

    return null;
  } catch {
    // Not JSON - treat as raw terminal input
    const str = typeof data === 'string' ? data : data.toString('utf-8');
    return { type: 'data', data: str };
  }
}

/**
 * Handle new WebSocket connection for terminal
 */
export function handleTerminalConnection(
  ws: ServerWebSocket<unknown>,
  tmuxSession: string
): void {
  console.log(`Terminal WebSocket connected for tmux session: ${tmuxSession}`);

  // Find tmux path
  const tmuxPaths = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
  let tmuxPath = 'tmux';

  for (const path of tmuxPaths) {
    try {
      const file = Bun.file(path);
      if (file.size > 0) {
        tmuxPath = path;
        break;
      }
    } catch {
      // Continue to next path
    }
  }

  console.log(`Using tmux at: ${tmuxPath}`);

  try {
    // First, ensure session exists and enable mouse mode for scrolling
    // Use has-session to check, new-session to create if needed, then set-option
    Bun.spawnSync([tmuxPath, 'has-session', '-t', tmuxSession], { stdout: 'ignore', stderr: 'ignore' });
    // Create session if it doesn't exist (detached)
    Bun.spawnSync([tmuxPath, 'new-session', '-d', '-s', tmuxSession], { stdout: 'ignore', stderr: 'ignore' });
    // Enable mouse mode on this session for scroll support
    Bun.spawnSync([tmuxPath, 'set-option', '-t', tmuxSession, 'mouse', 'on'], { stdout: 'ignore', stderr: 'ignore' });

    // Spawn tmux attach with PTY terminal using Bun's native terminal option
    const proc = Bun.spawn([tmuxPath, 'attach-session', '-t', tmuxSession], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
      cwd: process.env.HOME || '/',
      terminal: {
        cols: 80,
        rows: 24,
        // Called when data is received from the terminal
        data(terminal, data) {
          try {
            if (ws.readyState === 1) { // WebSocket.OPEN
              // Convert Uint8Array to string and send to WebSocket
              ws.send(new TextDecoder().decode(data));
            }
          } catch (err) {
            console.error('Error sending terminal data to WebSocket:', err);
          }
        },
        // Called when PTY stream closes
        exit(terminal, exitCode, signal) {
          console.log(`Terminal PTY closed for ${tmuxSession}: exitCode=${exitCode}, signal=${signal}`);
        },
      },
    });

    // Store active terminal
    activeTerminals.set(ws, {
      process: proc as Subprocess<'ignore', 'ignore', 'ignore'>,
      terminal: proc.terminal!,
      tmuxSession,
    });

    // Handle process exit
    proc.exited.then((exitCode) => {
      console.log(`Terminal process exited for ${tmuxSession}: code=${exitCode}`);
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
      activeTerminals.delete(ws);
    });

  } catch (err) {
    console.error('Failed to create terminal process:', err);
    try {
      ws.send('\x1b[31mError: Failed to start terminal. Check if tmux is installed.\x1b[0m\r\n');
      ws.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Handle incoming WebSocket message for terminal
 */
export function handleTerminalMessage(
  ws: ServerWebSocket<unknown>,
  message: string | Buffer
): void {
  const active = activeTerminals.get(ws);
  if (!active) {
    console.warn('Received message for unknown terminal connection');
    return;
  }

  const parsed = parseMessage(message);
  if (!parsed) {
    return;
  }

  if (parsed.type === 'resize') {
    // Resize the terminal
    try {
      active.terminal.resize(parsed.cols, parsed.rows);
    } catch (err) {
      // Resize is best-effort
      console.error('Error resizing terminal:', err);
    }
  } else if (parsed.type === 'data') {
    // Write data to terminal
    try {
      active.terminal.write(parsed.data);
    } catch (err) {
      console.error('Error writing to terminal:', err);
    }
  }
}

/**
 * Handle WebSocket disconnection for terminal
 */
export function handleTerminalDisconnection(ws: ServerWebSocket<unknown>): void {
  const active = activeTerminals.get(ws);
  if (active) {
    console.log(`Terminal WebSocket disconnected for: ${active.tmuxSession}`);
    try {
      active.terminal.close();
      active.process.kill();
    } catch {
      // Ignore kill errors
    }
    activeTerminals.delete(ws);
  }
}

/**
 * Get count of active terminal connections
 */
export function getActiveTerminalCount(): number {
  return activeTerminals.size;
}
