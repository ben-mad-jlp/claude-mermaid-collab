---
name: vibe-agents
description: Toggle agent mode on/off for the current vibe session
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__list_documents, mcp__plugin_mermaid-collab_mermaid__get_document, mcp__plugin_mermaid-collab_mermaid__patch_document, mcp__plugin_mermaid-collab_mermaid__create_document
---

# Vibe Agents

Toggle agent mode for the current vibe session. When on, heavy tasks (research, implementation, debugging, deployment) are offered as agent dispatches to keep the main context window clean.

Agent mode preference is stored as a `## Agent Mode` section in the vibeinstructions document.

## Usage

- `/vibe-agents on` — enable agent mode
- `/vibe-agents off` — disable agent mode
- `/vibe-agents` — show current status

## Steps

### Step 1 — Find the vibeinstructions document

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.

Look for a document whose `name` ends with `vibeinstructions`. If found, call `mcp__plugin_mermaid-collab_mermaid__get_document` to read its content.

### Step 2 — Handle argument

**If called with `on`:**

Update the vibeinstructions document to include `## Agent Mode\nEnabled` (use `patch_document` to replace the Agent Mode section, or append it if not present). If no vibeinstructions document exists, create one with `create_document` containing just the Agent Mode section.

Respond: "Agent mode **on**. I'll offer to dispatch heavy tasks (research, implementation, debugging, deployment) as agents to keep context clean."

**If called with `off`:**

Update the vibeinstructions document to include `## Agent Mode\nDisabled` (use `patch_document` to replace the Agent Mode section, or append it if not present).

Respond: "Agent mode **off**. All tasks will run in the main conversation."

**If called with no argument:**

Read the `## Agent Mode` section from the vibeinstructions document:
- If `Enabled`: "Agent mode is currently **on**. Run `/vibe-agents off` to disable."
- If `Disabled` or section not found: "Agent mode is currently **off**. Run `/vibe-agents on` to enable."
