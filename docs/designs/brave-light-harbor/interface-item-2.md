# Interface: Item 2 - Unified Server Startup

## File Structure
- `package.json` - Add unified dev script
- `bin/mermaid-collab.ts` - Update start command to include ttyd

## Configuration Changes

```json
// package.json scripts section
{
  "scripts": {
    "dev": "concurrently -n api,ui,term -c blue,green,yellow \"bun run src/server.ts\" \"cd ui && bun run dev\" \"ttyd -p 7681 -W bash\"",
    "dev:api": "bun run src/server.ts",
    "dev:ui": "cd ui && bun run dev",
    "dev:term": "ttyd -p 7681 -W bash"
  }
}
```

## Dependencies

```json
// package.json devDependencies
{
  "concurrently": "^8.2.2"
}
```

## CLI Interface

```bash
# Single command starts all services
bun run dev

# Individual services (for debugging)
bun run dev:api   # API on :3737
bun run dev:ui    # UI on :5173  
bun run dev:term  # Terminal on :7681
```

## Service Ports
| Service | Port | Protocol |
|---------|------|----------|
| API     | 3737 | HTTP     |
| UI      | 5173 | HTTP     |
| Terminal| 7681 | WebSocket|

## Notes
- MCP server started separately by Claude Code (not part of dev script)
- ttyd must be installed: `brew install ttyd` or system package manager
