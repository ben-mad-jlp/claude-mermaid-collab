# Dashboard Folders, Locking & Import

## Overview

Add folder organization, item locking, and file/text import to the dashboard.

## Data Model

**Metadata file: `metadata.json`** in project root:

```json
{
  "folders": ["Project A", "Archive", "WIP"],
  "items": {
    "my-diagram": { "folder": "Project A", "locked": false },
    "design-doc": { "folder": "Project A", "locked": true },
    "old-thing": { "folder": "Archive", "locked": false }
  }
}
```

**Rules:**
- Items not in metadata = root folder, unlocked (backwards compatible)
- `folder: null` or missing = root folder
- Folders list tracks folder order and allows empty folders to exist
- File auto-created on first folder/lock operation

## API Additions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/metadata` | GET | Get full metadata |
| `/api/metadata/item/:id` | POST | Update item's folder/locked status |
| `/api/metadata/folders` | POST | Create/rename/delete folders |

**WebSocket event:** `metadata_updated` - broadcast when metadata changes

## UI Changes

### Header (left to right)
- Title: "Collaboration Dashboard"
- Folder dropdown: "All Items" / "Root" / folder names
- Type filter (existing)
- Search box (existing)
- **"+" button** - dropdown: "New Folder", "Import File", "Import Text"
- Delete All button (existing)
- Theme toggle (existing)
- Connection status (existing)

### Folder Dropdown Behavior
- "All Items" - shows everything across all folders
- "Root" - shows items not in any folder
- Folder names - shows only items in that folder
- "Manage Folders..." option at bottom (rename/delete)

### Card Changes
- Lock icon button (top-left area) - outline style, toggles locked/unlocked
- Locked items show subtle visual indicator (border or dimmed delete button)
- All icons use basic outlines, no colors

### Empty State
When current folder is empty:
- "No items in this folder"
- Three buttons: "Import File", "Import Text", "Move items here"

## Interactions

### Locking
- Click lock icon toggles state immediately
- Locked items: delete button disabled with "Unlock to delete" tooltip
- Locked items cannot be deleted individually or via Delete All

### Delete All
- Only deletes items in current folder view
- "All Items" view: deletes everything except locked
- "Root" view: deletes only root items except locked
- Folder view: deletes only that folder's items except locked
- Confirmation: "Delete all unlocked items in [folder]? (X locked will be kept)"

### Import File
- File picker accepts: `.mmd`, `.md`, `.txt`, `.yaml`
- Detects type by extension/content
- Creates item in current folder (root if "All Items")
- Prompts for name if filename is generic

### Import Text
- Modal with textarea + name input
- Auto-detects type from content
- Creates in current folder

### Folder Management
- Create: prompt for name
- Rename: inline edit or modal
- Delete: only if empty, or offer to move items to root

## Implementation Order

1. Metadata manager service + API endpoints
2. API client updates
3. Lock icon on cards
4. Folder dropdown + filtering
5. Delete All respects locks + folder scope
6. Import file/text functionality
7. Folder management (create/rename/delete)

## Files to Modify

| File | Changes |
|------|---------|
| `src/services/metadata-manager.ts` | New - load/save metadata, CRUD |
| `src/routes/api.ts` | Add metadata endpoints |
| `src/server.ts` | Wire up metadata manager |
| `public/js/api-client.js` | Add metadata API methods |
| `public/js/dashboard.js` | Folder dropdown, locks, import, delete all |
| `public/index.html` | New UI elements |
| `public/css/styles.css` | Lock icon, dropdown, modal styles |
