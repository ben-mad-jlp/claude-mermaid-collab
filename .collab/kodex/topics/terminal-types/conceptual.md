# Terminal Types

Type definitions shared between backend terminal services and frontend components.

## Core Types

- **TerminalSession**: Represents a terminal tab with ID, name, tmux session, and ordering
- **TerminalSessionsState**: Collection of sessions with last modified timestamp
- **MCP Result Types**: Response types for terminal MCP tools

## Usage

Types are defined in `src/types/terminal.ts` and can be imported by both backend services and frontend components for type safety.