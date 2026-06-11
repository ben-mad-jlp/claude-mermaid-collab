## WebSocketHandler Class

```typescript
class WebSocketHandler {
  private connections: Set<ServerWebSocket>;
  
  // Connection lifecycle
  handleConnection(ws: ServerWebSocket): void
  handleMessage(ws: ServerWebSocket, message: string): void
  handleDisconnection(ws: ServerWebSocket): void
  
  // Broadcasting
  broadcast(message: WSMessage): void
  broadcastToDiagram(id: string, message: WSMessage): void
  broadcastToDocument(id: string, message: WSMessage): void
  broadcastNotification(data: NotificationData): void
  broadcastStatus(status: string, message?: string): void
  
  getConnectionCount(): number
}
```

## Message Types (17 Types)

**Diagram Operations:**
- `diagram_created` - id, name, content, project, session
- `diagram_updated` - id, content, optional patch
- `diagram_deleted` - id

**Document Operations:**
- `document_created`, `document_updated`, `document_deleted`

**UI/Interaction:**
- `ui_render` - uiId, ui object, blocking flag
- `ui_dismissed` - uiId
- `ui_updated` - Partial patch
- `question_responded` - Response data

**System:**
- `connected` - Initial confirmation
- `session_created` - New session
- `notification` - type, title, message, duration
- `status_changed` - status, lastActivity
- `metadata_updated` - Updates, foldersChanged

**Subscriptions:**
- `subscribe` - id or channel
- `unsubscribe` - id or channel

## Subscription System

**Item-Based:**
```json
{ "type": "subscribe", "id": "diagram_1" }
```
Stored directly: `subscriptions.add('diagram_1')`

**Channel-Based:**
```json
{ "type": "subscribe", "channel": "notifications" }
```
Stored with prefix: `subscriptions.add('channel:notifications')`

## Broadcasting Patterns

**Global Broadcast:**
```typescript
wsHandler.broadcast({ type: 'session_created', project, session })
```
Sends to ALL connected clients.

**Targeted Broadcast:**
```typescript
wsHandler.broadcastToDiagram(id, { type: 'diagram_updated', ... })
```
Only sends to clients subscribed to that diagram ID.

## Error Handling

- Dead connections tracked during broadcast
- Failed sends logged, connection removed
- No message buffering - fire and forget
- JSON stringified once, reused for all recipients