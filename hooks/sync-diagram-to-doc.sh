#!/bin/bash
# hooks/sync-diagram-to-doc.sh
# PostToolUse hook for diagram create/update
# Syncs diagram content to design doc

set -e

# Read JSON input from stdin (Claude Code hook input format)
INPUT=$(cat)

# Parse diagram ID from tool_output field
DIAGRAM_ID=$(echo "$INPUT" | jq -r '.tool_output.id // empty')
[ -z "$DIAGRAM_ID" ] && exit 0

# Find session path
find_session_path() {
    if [ -n "$COLLAB_SESSION_PATH" ]; then
        echo "$COLLAB_SESSION_PATH"
        return
    fi

    local current="$PWD"
    while [ "$current" != "/" ]; do
        if [ -d "$current/.collab" ]; then
            local latest=$(ls -t "$current/.collab" 2>/dev/null | head -1)
            if [ -n "$latest" ]; then
                echo "$current/.collab/$latest"
                return
            fi
        fi
        current=$(dirname "$current")
    done
}

SESSION_PATH=$(find_session_path)
[ -z "$SESSION_PATH" ] && exit 0

# Read diagram content
DIAGRAM_FILE="$SESSION_PATH/diagrams/$DIAGRAM_ID.mmd"
[ ! -f "$DIAGRAM_FILE" ] && exit 0
DIAGRAM_CONTENT=$(cat "$DIAGRAM_FILE")

# Read or create design doc
DOC_FILE="$SESSION_PATH/documents/design.md"
if [ -f "$DOC_FILE" ]; then
    DOC_CONTENT=$(cat "$DOC_FILE")
else
    # Create initial document with Diagrams section
    DOC_CONTENT="# Design

## Diagrams"
fi

# Ensure "## Diagrams" section exists
if ! echo "$DOC_CONTENT" | grep -q "^## Diagrams"; then
    DOC_CONTENT="$DOC_CONTENT

## Diagrams"
fi

# Check if this diagram section already exists
if echo "$DOC_CONTENT" | grep -q "^### $DIAGRAM_ID\$"; then
    # Update existing diagram section - replace content between ```mermaid and ```
    # Use awk to find the section and replace the mermaid block
    DOC_CONTENT=$(echo "$DOC_CONTENT" | awk -v diagram_id="$DIAGRAM_ID" -v new_content="$DIAGRAM_CONTENT" '
        BEGIN { in_section = 0; in_mermaid = 0; found_section = 0 }

        # Match the diagram section header
        /^### / {
            if ($0 == "### " diagram_id) {
                in_section = 1
                found_section = 1
            } else if (in_section) {
                in_section = 0
            }
            print
            next
        }

        # Match start of mermaid block in our section
        /^```mermaid/ {
            if (in_section && !in_mermaid) {
                in_mermaid = 1
                print "```mermaid"
                print new_content
                next
            }
            print
            next
        }

        # Match end of mermaid block
        /^```$/ {
            if (in_section && in_mermaid) {
                in_mermaid = 0
                print "```"
                next
            }
            print
            next
        }

        # Skip content inside mermaid block (will be replaced)
        {
            if (in_section && in_mermaid) {
                next
            }
            print
        }
    ')
else
    # Append new diagram section after "## Diagrams"
    # Find the position after "## Diagrams" and insert at the end of that section
    DOC_CONTENT=$(echo "$DOC_CONTENT" | awk -v diagram_id="$DIAGRAM_ID" -v new_content="$DIAGRAM_CONTENT" '
        BEGIN { found_diagrams = 0; inserted = 0 }

        # Detect ## Diagrams line
        /^## Diagrams/ {
            found_diagrams = 1
            print
            next
        }

        # Insert before the next ## section (but not ### or ## Diagrams itself)
        /^## / && !/^## Diagrams/ {
            if (found_diagrams && !inserted) {
                print ""
                print "### " diagram_id
                print "```mermaid"
                print new_content
                print "```"
                print ""
                inserted = 1
            }
            print
            next
        }

        { print }

        END {
            if (found_diagrams && !inserted) {
                print ""
                print "### " diagram_id
                print "```mermaid"
                print new_content
                print "```"
            }
        }
    ')
fi

# Write the updated document
mkdir -p "$(dirname "$DOC_FILE")"
printf '%s\n' "$DOC_CONTENT" > "$DOC_FILE"

exit 0
