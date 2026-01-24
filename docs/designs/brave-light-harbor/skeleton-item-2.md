# Skeleton: Item 2 - Unified Server Startup

## File Stubs

### package.json (MODIFY)
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

### setup.sh (MODIFY)
```bash
# TODO: Add ttyd installation check
# - Check if ttyd is installed
# - Provide installation instructions if missing
# - macOS: brew install ttyd
# - Linux: apt install ttyd
```

## Dependencies

```bash
# Install concurrently
bun add -d concurrently

# ttyd must be installed system-wide
# macOS: brew install ttyd
# Linux: sudo apt install ttyd
```

## Task Dependency Graph

```yaml
tasks:
  - id: install-concurrently
    files: [package.json]
    description: Add concurrently as dev dependency
    parallel: true

  - id: update-scripts
    files: [package.json]
    description: Add unified dev script and individual service scripts
    depends-on: [install-concurrently]

  - id: setup-ttyd-check
    files: [setup.sh]
    description: Add ttyd installation verification to setup script
    parallel: true
```
