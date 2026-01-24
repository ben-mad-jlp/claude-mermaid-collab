# Pseudocode: Item 2 - Unified Server Startup

## package.json Script Changes

```json
{
  "scripts": {
    "dev": "concurrently -n api,ui,term -c blue,green,yellow \"bun run src/server.ts\" \"cd ui && bun run dev\" \"ttyd -p 7681 -W bash\"",
    "dev:api": "bun run src/server.ts",
    "dev:ui": "cd ui && bun run dev", 
    "dev:term": "ttyd -p 7681 -W bash"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

## Startup Sequence

```
WHEN user runs "bun run dev":
  
  1. concurrently spawns three processes:
     
     PROCESS api (blue):
       bun run src/server.ts
       → Starts on port 3737
       → Serves API endpoints
       → Handles WebSocket connections for UI updates
     
     PROCESS ui (green):
       cd ui && bun run dev
       → Starts Vite dev server on port 5173
       → Proxies API requests to localhost:3737
     
     PROCESS term (yellow):
       ttyd -p 7681 -W bash
       → Starts ttyd WebSocket terminal on port 7681
       → -W flag enables writable mode (bidirectional)
  
  2. All processes run concurrently
  3. Ctrl+C kills all processes together
```

## Dependencies Installation

```bash
# Install concurrently
bun add -d concurrently

# ttyd must be installed separately
# macOS: brew install ttyd
# Linux: apt install ttyd or build from source
```

## Verification

```
FUNCTION verifySetup():
  CHECK port 3737 responds (API)
  CHECK port 5173 responds (UI)
  CHECK port 7681 WebSocket connects (Terminal)
  
  IF all checks pass:
    PRINT "All services running"
  ELSE:
    PRINT "Missing services: {failed checks}"
```

## Error Handling

- If port already in use: concurrently shows which process failed
- If ttyd not installed: Clear error message with install instructions
- Process crash: concurrently can be configured to restart
