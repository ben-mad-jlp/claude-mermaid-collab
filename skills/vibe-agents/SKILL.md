---
name: vibe-agents
description: Toggle agent mode on/off for the current vibe session
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__list_documents, mcp__plugin_mermaid-collab_mermaid__get_document, mcp__plugin_mermaid-collab_mermaid__patch_document, mcp__plugin_mermaid-collab_mermaid__create_document
---

# Vibe Agents

Toggle agent mode for the current vibe session. When on, heavy tasks (research, implementation, debugging, deployment) are offered as agent dispatches to keep the main context window clean.

Agent mode preference is stored as a `## Agent Mode` section in the vibeinstructions document. Pair mode preference is stored as a `## Pair Mode` section in the same document.

## Usage

- `/vibe-agents on` — enable agent mode
- `/vibe-agents off` — disable agent mode
- `/vibe-agents pair on` — enable pair mode
- `/vibe-agents pair off` — disable pair mode
- `/vibe-agents` — show current status for both modes

## Steps

### Step 1 — Find the vibeinstructions document

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.

Look for a document whose `name` ends with `vibeinstructions`. If found, call `mcp__plugin_mermaid-collab_mermaid__get_document` to read its content.

### Step 2 — Handle argument

**If called with `on`:**

Update the vibeinstructions document to include `## Agent Mode\nEnabled` (use `patch_document` to replace the Agent Mode section, or append it if not present). If no vibeinstructions document exists, create one with `create_document` containing just the Agent Mode section.

Respond: "Agent mode **on**. I'll offer to dispatch heavy tasks as agents to keep context clean."

**If called with `off`:**

Update the vibeinstructions document to include `## Agent Mode\nDisabled` (use `patch_document` to replace the Agent Mode section, or append it if not present).

Respond: "Agent mode **off**. All tasks will run in the main conversation."

**If called with `pair on`:**

1. Update the vibeinstructions document to include `## Pair Mode\nEnabled` (use `patch_document` to replace the Pair Mode section, or append it if not present). If no vibeinstructions document exists, create one with `create_document` containing the Pair Mode section.
2. Invoke the `pair` skill via the Skill tool to load its content into context.
3. Respond: "Pair mode **on**. Behavioral changes will require before/after diagram approval before I write any code."

**If called with `pair off`:**

1. Update the vibeinstructions document to include `## Pair Mode\nDisabled` (use `patch_document` to replace the Pair Mode section, or append it if not present).
2. Respond: "Pair mode **off**. Editing with native approvals only."

**If called with no argument:**

Read both the `## Agent Mode` and `## Pair Mode` sections from the vibeinstructions document and show both statuses:

- Agent mode: If `Enabled`: "Agent mode is currently **on**. Run `/vibe-agents off` to disable." If `Disabled` or section not found: "Agent mode is currently **off**. Run `/vibe-agents on` to enable."
- Pair mode: If `Enabled`: "Pair mode is currently **on**. Run `/vibe-agents pair off` to disable." If `Disabled` or section not found: "Pair mode is currently **off**. Run `/vibe-agents pair on` to enable."
