---
name: vibe-agents
description: Toggle agent mode on/off for the current vibe session
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__get_session_state, mcp__plugin_mermaid-collab_mermaid__update_session_state
---

# Vibe Agents

Toggle agent mode for the current vibe session. When on, heavy tasks (research, implementation, debugging, deployment) are offered as agent dispatches to keep the main context window clean.

## Usage

- `/vibe-agents on` — enable agent mode
- `/vibe-agents off` — disable agent mode
- `/vibe-agents` — show current status

## Steps

### Step 1 — Get session state

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
Args: { "project": "<cwd>", "session": "<session>" }
```

### Step 2 — Handle argument

**If called with `on`:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: { "project": "<cwd>", "session": "<session>", "agentMode": true }
```
Respond: "Agent mode **on**. I'll offer to dispatch heavy tasks (research, implementation, debugging, deployment) as agents to keep context clean."

**If called with `off`:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: { "project": "<cwd>", "session": "<session>", "agentMode": false }
```
Respond: "Agent mode **off**. All tasks will run in the main conversation."

**If called with no argument:**
Read `agentMode` from session state and respond:
- If `true`: "Agent mode is currently **on**. Run `/vibe-agents off` to disable."
- If `false` or unset: "Agent mode is currently **off**. Run `/vibe-agents on` to enable."
