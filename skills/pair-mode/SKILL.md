---
name: pair-mode
description: Toggle pair mode on/off for the current vibe session. When on, every behavioral code change requires a before/after diagram approved by the human before writing any code.
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__list_documents, mcp__plugin_mermaid-collab_mermaid__get_document, mcp__plugin_mermaid-collab_mermaid__patch_document, mcp__plugin_mermaid-collab_mermaid__create_document
---

# Pair Mode

Toggle pair mode for the current vibe session. When on, every behavioral code change requires a before/after diagram approved by the human before writing any code.

Pair mode preference is stored as a `## Pair Mode` section in the vibeinstructions document.

## Usage

- `/pair-mode on` — enable pair mode
- `/pair-mode off` — disable pair mode
- `/pair-mode` — show current status

## Steps

### Step 1 — Find the vibeinstructions document

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.

Look for a document whose `name` ends with `vibeinstructions`. If found, call `mcp__plugin_mermaid-collab_mermaid__get_document` to read its content.

### Step 2 — Handle argument

**If called with `on`:**

1. Update the vibeinstructions document to include `## Pair Mode\nEnabled` (use `patch_document` to replace the Pair Mode section, or append it if not present). If no vibeinstructions document exists, create one with `create_document` containing the Pair Mode section.
2. Invoke the `pair` skill via the Skill tool to load its content into context.
3. Respond: "Pair mode **on**. Behavioral changes will require before/after diagram approval before I write any code."

**If called with `off`:**

1. Update the vibeinstructions document to include `## Pair Mode\nDisabled` (use `patch_document` to replace the Pair Mode section, or append it if not present).
2. Respond: "Pair mode **off**. Editing with native approvals only."

**If called with no argument:**

Read the `## Pair Mode` section from the vibeinstructions document and show status:

- If `Enabled`: "Pair mode is currently **on**. Run `/pair-mode off` to disable."
- If `Disabled` or section not found: "Pair mode is currently **off**. Run `/pair-mode on` to enable."
