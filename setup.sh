#!/bin/bash
# setup.sh - Build and prepare mermaid-collab server after plugin updates
#
# Usage: ./setup.sh [--start]
#   --start    Also start the server after setup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=${MERMAID_PORT:-9002}

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

# Step 0: Create MCP permissions file
setup_mcp_permissions() {
  local settings_dir=".claude"
  local settings_file="$settings_dir/settings.local.json"

  # Create .claude directory if it doesn't exist
  if [[ ! -d "$settings_dir" ]]; then
    info "Creating $settings_dir directory..."
    mkdir -p "$settings_dir"
  fi

  # Create settings file with mermaid tool allowances if it doesn't exist
  if [[ ! -f "$settings_file" ]]; then
    info "Creating MCP permissions file..."
    cat > "$settings_file" << 'EOF'
{
  "permissions": {
    "allow": [
      "mcp__mermaid__*",
      "mcp__plugin_mermaid-collab_mermaid__*"
    ]
  },
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["mermaid"]
}
EOF
  fi
}

setup_mcp_permissions

# Install statusline hook to ~/.claude/statusline.sh and wire up settings.json
setup_statusline() {
  local src="$SCRIPT_DIR/scripts/statusline.sh"
  local dst="$HOME/.claude/statusline.sh"
  local settings="$HOME/.claude/settings.json"

  if [[ ! -f "$src" ]]; then
    warn "scripts/statusline.sh not found — skipping statusline setup"
    return
  fi

  cp "$src" "$dst" && chmod +x "$dst"
  info "Installed statusline hook → $dst"

  # Wire up settings.json statusLine if not already pointing to our script
  if [[ -f "$settings" ]]; then
    local current
    current=$(python3 -c "import json,sys; d=json.load(open('$settings')); print(d.get('statusLine',{}).get('command',''))" 2>/dev/null || echo "")
    if [[ "$current" != "$dst" && "$current" != "~/.claude/statusline.sh" ]]; then
      python3 - "$settings" "$dst" <<'PYEOF'
import json, sys
path, script = sys.argv[1], sys.argv[2]
with open(path) as f:
    d = json.load(f)
d['statusLine'] = {"type": "command", "command": script, "padding": 0}
with open(path, 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
PYEOF
      info "Configured statusLine in $settings"
    fi
  else
    warn "$settings not found — create it manually and set statusLine to $dst"
  fi
}

setup_statusline

# Check for ttyd installation
check_ttyd() {
  if ! command -v ttyd &> /dev/null; then
    error "ttyd is not installed"
    echo ""
    echo "To install ttyd, run:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      echo "  brew install ttyd"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      echo "  apt install ttyd"
    else
      echo "  See https://github.com/tsl0922/ttyd for installation instructions"
    fi
    echo ""
    return 1
  fi
  return 0
}

# Check ttyd before setup
if ! check_ttyd; then
  exit 1
fi

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
