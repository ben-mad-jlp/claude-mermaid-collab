# MCP Server

The MCP (Model Context Protocol) Server provides the interface between Claude Code and the mermaid-collab plugin. It exposes tools for diagram management, document handling, UI rendering, session state, terminal sessions, and Kodex knowledge base operations.

## Architecture

The server supports two transport modes:

1. **Stdio Transport** (`server.ts`) - Legacy mode for backwards compatibility. Requires the HTTP API server to be running first.

2. **Streamable HTTP Transport** (`http-handler.ts`, `http-transport.ts`) - Modern transport using a single endpoint for all MCP communication with session management via `Mcp-Session-Id` header.

## Key Concepts

- **Session Management**: HTTP sessions auto-expire after 30 minutes of inactivity. Sessions are cleaned up every 60 seconds.
- **Tool Categories**: Diagram tools, Document tools, UI tools, Session state tools, Terminal tools, Kodex tools
- **Resources**: Provides the wireframe syntax guide as an MCP resource