# Pseudocode: Item 9 - Improve Compact Messaging

## Skill Pattern for Compact Notification

```
# In skills that detect context limits (collab-compact, rough-draft, etc.)

FUNCTION notifyCompactNeeded(session):
  # Send visible message to GUI
  CALL mcp__mermaid__render_ui({
    project: getCurrentProject(),
    session: session,
    ui: {
      type: 'Alert',
      props: {
        type: 'warning',
        title: 'Context Full',
        message: 'Run /compact in terminal, then /collab to resume.'
      }
    },
    blocking: false
  })
```

## collab-compact Skill Update

```
# In skills/collab-compact/SKILL.md

## Step 4: Notify User via GUI

Before triggering compact, ensure user sees the message in the browser:

CALL render_ui with Alert:
  type: warning
  title: Context Full  
  message: Run /compact in terminal, then /collab to resume.
  blocking: false

Then instruct to run /compact.
```

## Alert Component (Existing)

```
# Alert already exists in AI-UI components
# Just need skills to use it properly

FUNCTION Alert({ type, title, message }):
  iconMap = {
    warning: WarningIcon,
    error: ErrorIcon,
    info: InfoIcon,
    success: SuccessIcon
  }
  
  Icon = iconMap[type]
  
  RETURN (
    <div className={cn("alert", `alert-${type}`)}>
      <Icon className="alert-icon" />
      <div className="alert-content">
        IF title:
          <div className="alert-title">{title}</div>
        <div className="alert-message">{message}</div>
      </div>
    </div>
  )
```

## Integration Points

Skills that may trigger compact:
1. rough-draft (after each phase)
2. brainstorming (after each section)
3. executing-plans (during long implementations)
4. collab (during work item loop)

Each should use render_ui with Alert when detecting high context usage.

## Message Visibility

- Alert appears in the message area (top of right pane)
- User sees it in browser, doesn't need to watch terminal
- Non-blocking so skill can continue with instructions
