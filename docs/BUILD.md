# Building the MCP Server

## Prerequisites

- Bun runtime (https://bun.sh)
- Node.js and npm (for wireframe plugin)

## Quick Setup

Run the setup script:

```bash
./setup.sh
```

Or with auto-start:

```bash
./setup.sh --start
```

## Manual Build Steps

### Step 1: Build wireframe plugin

```bash
cd plugins/wireframe
npm install
npm run build
```

### Step 2: Verify wireframe build

```bash
ls plugins/wireframe/dist/mermaid-wireframe.mjs
# Should exist
```

### Step 3: Install root dependencies

```bash
cd ../..  # back to project root
bun install
```

### Step 4: Start server

```bash
bun run src/server.ts
```

### Step 5: Verify server running

```bash
curl http://localhost:3737
# Should return HTML
```

## Troubleshooting

### "Cannot find module mermaid-wireframe"

Wireframe plugin not built. Run:

```bash
cd plugins/wireframe && npm run build
```

### "EADDRINUSE: port 3737"

Server already running. Kill it:

```bash
lsof -ti:3737 | xargs kill
```

### Build fails in plugins/wireframe

- Check Node.js version: `node --version` (need 18+)
- Delete node_modules and reinstall: `rm -rf node_modules && npm install`

### "bun: command not found"

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```
