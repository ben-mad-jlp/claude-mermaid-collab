# Interface: Item 3 - Task Subagent Parallel Dispatch Fix

## [APPROVED]

## File Structure
- `skills/executing-plans/execution.md` - Add parallel dispatch example

## Changes

### execution.md - After line 85

**Add explicit example:**
```markdown
### Parallel Dispatch Example

When dispatching multiple parallel-safe tasks, use a SINGLE message with multiple Task tool calls:

```
[In one response, make multiple tool calls:]

<Task tool call>
  description: "Implement auth-types"
  prompt: "You are implementing task auth-types..."
  subagent_type: "mermaid-collab:subagent-driven-development:implementer-prompt"
</Task tool call>

<Task tool call>
  description: "Implement utils"
  prompt: "You are implementing task utils..."
  subagent_type: "mermaid-collab:subagent-driven-development:implementer-prompt"
</Task tool call>

<Task tool call>
  description: "Implement config"
  prompt: "You are implementing task config..."
  subagent_type: "mermaid-collab:subagent-driven-development:implementer-prompt"
</Task tool call>
```

**CRITICAL:** All three Task tool calls appear in the SAME message.
Do NOT wait for one to complete before starting the next.
The agents run concurrently.

**WRONG - Sequential dispatch:**
```
Message 1: [Task tool call for auth-types]
[Wait for completion]
Message 2: [Task tool call for utils]
[Wait for completion]
Message 3: [Task tool call for config]
```
```

## Verification
- [ ] Example shows multiple Task calls in one message
- [ ] Wrong pattern is explicitly shown
- [ ] "CRITICAL" callout emphasizes the requirement
