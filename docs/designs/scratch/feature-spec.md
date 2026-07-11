# Feature Spec: Notification System

## Goal
Add a real-time notification system to the collab UI.

## Requirements
- Users see notifications when documents are updated
- Notifications have read/unread state
- Bell icon in header shows unread count
- Clicking notification navigates to the artifact

## API
- `GET /api/notifications` — list notifications
- `POST /api/notifications/:id/read` — mark as read
- WebSocket event: `notification` with `{ id, message, artifactId }`

## Components
- `NotificationBell` — header icon with badge
- `NotificationPanel` — dropdown list
- `useNotifications` — hook for state management
