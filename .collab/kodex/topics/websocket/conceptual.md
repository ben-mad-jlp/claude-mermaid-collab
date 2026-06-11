# WebSocket Communication

WebSocket provides real-time bidirectional communication between the server and browser clients. It enables live updates for diagram/document changes, UI rendering, notifications, and status changes.

## Architecture

The WebSocket handler manages:
- Connection lifecycle (open, message, close)
- Subscription-based message filtering
- Broadcasting to targeted or all clients
- Dead connection cleanup

## Key Use Cases

1. **Live Collaboration** - Diagram/document updates pushed to all viewers
2. **UI Rendering** - `render_ui` pushes UI components to browser
3. **Notifications** - Toast messages for events
4. **Status Updates** - Agent working/waiting/idle states