#!/bin/bash
# setup.sh - Build and prepare mermaid-collab server after plugin updates
#
# Usage: ./setup.sh [--start]
#   --start    Also start the server after setup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=${MERMAID_PORT:-3737}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Parse args
START_SERVER=false
for arg in "$@"; do
  case $arg in
    --start) START_SERVER=true ;;
  esac
done

# Step 1: Install wireframe plugin dependencies (must happen before root install)
info "Installing wireframe plugin dependencies..."
cd plugins/wireframe
npm install

# Step 2: Build wireframe plugin (parser + bundle)
info "Building wireframe plugin..."
npm run build

cd "$SCRIPT_DIR"

# Step 3: Verify build output exists
if [[ ! -f "plugins/wireframe/dist/mermaid-wireframe.mjs" ]]; then
  error "Build failed - dist files not found"
  exit 1
fi

# Step 4: Install/link root dependencies (now that wireframe is built)
info "Installing root dependencies and linking wireframe plugin..."
bun install

info "Setup complete!"

# Optional: Start server
if [[ "$START_SERVER" == true ]]; then
  # Check if server already running
  if curl --silent --fail --max-time 1 "http://localhost:$PORT" > /dev/null 2>&1; then
    warn "Server already running on port $PORT"
  else
    info "Starting server on port $PORT..."
    bun run src/server.ts &

    # Wait for server to be ready
    for i in {1..10}; do
      if curl --silent --fail --max-time 1 "http://localhost:$PORT" > /dev/null 2>&1; then
        info "Server ready at http://localhost:$PORT"
        exit 0
      fi
      sleep 0.5
    done

    error "Server failed to start"
    exit 1
  fi
fi
