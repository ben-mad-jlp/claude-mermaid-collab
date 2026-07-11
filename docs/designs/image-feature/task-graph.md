# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 13
- **Total waves:** 5
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** backend-types-config, frontend-types, session-registry
**Wave 2:** backend-image-manager, frontend-store, frontend-api-client, frontend-import-artifact
**Wave 3:** backend-api-routes, backend-mcp-tools, frontend-image-viewer, websocket-image-events
**Wave 4:** frontend-sidebar-integration
**Wave 5:** tests-e2e

## Task Graph (YAML)

```yaml
tasks:
  - id: backend-types-config
    files: []
    tests: []
    description: "Add Image/ImageMeta/ImageListItem types and MAX_IMAGE_SIZE, ALLOWED_IMAGE_MIME_TYPES config constants."
    parallel: true
    depends-on: []
  - id: frontend-types
    files: []
    tests: []
    description: "Add Image interface and add 'image' to the Item type union; re-export from the types barrel."
    parallel: true
    depends-on: []
  - id: session-registry
    files: []
    tests: []
    description: "Add 'images' to the resolvePath() artifact kind union so imageManager can resolve its directory."
    parallel: true
    depends-on: []
  - id: backend-image-manager
    files: []
    description: "New ImageManager service: initialize/create/list/get/getContent/delete over binary files + meta sidecars. Reuses the EmbedManager pattern."
    parallel: false
    depends-on: [backend-types-config, session-registry]
  - id: frontend-store
    files: []
    tests: []
    description: "Add images state slice + actions (setImages, addImage, selectImage, updateImage, removeImage) to the session store."
    parallel: true
    depends-on: [frontend-types]
  - id: frontend-api-client
    files: []
    tests: []
    description: "Add createImage (multipart), listImages, deleteImage methods to the api client."
    parallel: true
    depends-on: [frontend-types]
  - id: frontend-import-artifact
    files: []
    description: "Extend ArtifactType union with 'image'; detect image extensions in detectType; branch inside importArtifact to POST multipart for images while keeping the JSON path for text types."
    parallel: true
    depends-on: [frontend-types]
  - id: backend-api-routes
    files: []
    tests: []
    description: "Wire imageManager into createManagers(); add POST /api/image (multipart), GET /api/images, GET /api/image/:id, GET /api/image/:id/content (binary stream with Content-Type), DELETE /api/image/:id. Broadcast image_created / image_deleted."
    parallel: false
    depends-on: [backend-image-manager]
  - id: backend-mcp-tools
    files: []
    tests: []
    description: "MCP tool handlers + schemas for create_image, list_images, get_image, delete_image. Reuses loadImageBytes() from design-ai.ts for source-agnostic loading. Register in setup.ts ListTools + CallTool handlers."
    parallel: true
    depends-on: [backend-image-manager]
  - id: frontend-image-viewer
    files: []
    tests: []
    description: "New ImageViewer component: render <img> bound to /api/image/:id/content, show metadata and download link."
    parallel: true
    depends-on: [frontend-store]
  - id: frontend-sidebar-integration
    files: []
    tests: []
    description: "Render an Images section in the sidebar using ItemCard; wire onDragOver/onDragLeave/onDrop handlers on the artifact list container to call importArtifact() per file. Highlight the list while dragging. Rely on WebSocket broadcasts to update the store after upload."
    parallel: false
    depends-on: [frontend-store, frontend-import-artifact, frontend-image-viewer]
  - id: websocket-image-events
    files: []
    tests: []
    description: "Handle image_created and image_deleted WebSocket messages: update the session store (addImage / removeImage) so all clients see uploads in real time."
    parallel: true
    depends-on: [frontend-store]
  - id: tests-e2e
    files: []
    description: "Integration test: start test server, POST multipart to /api/image, assert file lands on disk with correct meta, GET /api/image/:id/content returns bytes with correct MIME, DELETE removes both files."
    parallel: false
    depends-on: [backend-api-routes, backend-mcp-tools, frontend-sidebar-integration, websocket-image-events]
```

## Dependency Visualization

```mermaid
graph TD
    backend-types-config["backend-types-config<br/>"Add Image/ImageMeta/ImageList..."]
    frontend-types["frontend-types<br/>"Add Image interface and add '..."]
    session-registry["session-registry<br/>"Add 'images' to the resolvePa..."]
    backend-image-manager["backend-image-manager<br/>"New ImageManager service: ini..."]
    frontend-store["frontend-store<br/>"Add images state slice + acti..."]
    frontend-api-client["frontend-api-client<br/>"Add createImage (multipart), ..."]
    frontend-import-artifact["frontend-import-artifact<br/>"Extend ArtifactType union wit..."]
    backend-api-routes["backend-api-routes<br/>"Wire imageManager into create..."]
    backend-mcp-tools["backend-mcp-tools<br/>"MCP tool handlers + schemas f..."]
    frontend-image-viewer["frontend-image-viewer<br/>"New ImageViewer component: re..."]
    frontend-sidebar-integration["frontend-sidebar-integration<br/>"Render an Images section in t..."]
    websocket-image-events["websocket-image-events<br/>"Handle image_created and imag..."]
    tests-e2e["tests-e2e<br/>"Integration test: start test ..."]

     --> backend-types-config
     --> frontend-types
     --> session-registry
    backend-types-config --> backend-image-manager
    session-registry --> backend-image-manager
    frontend-types --> frontend-store
    frontend-types --> frontend-api-client
    frontend-types --> frontend-import-artifact
    backend-image-manager --> backend-api-routes
    backend-image-manager --> backend-mcp-tools
    frontend-store --> frontend-image-viewer
    frontend-store --> frontend-sidebar-integration
    frontend-import-artifact --> frontend-sidebar-integration
    frontend-image-viewer --> frontend-sidebar-integration
    frontend-store --> websocket-image-events
    backend-api-routes --> tests-e2e
    backend-mcp-tools --> tests-e2e
    frontend-sidebar-integration --> tests-e2e
    websocket-image-events --> tests-e2e

    style backend-types-config fill:#c8e6c9
    style frontend-types fill:#c8e6c9
    style session-registry fill:#c8e6c9
    style backend-image-manager fill:#bbdefb
    style frontend-store fill:#bbdefb
    style frontend-api-client fill:#bbdefb
    style frontend-import-artifact fill:#bbdefb
    style backend-api-routes fill:#fff3e0
    style backend-mcp-tools fill:#fff3e0
    style frontend-image-viewer fill:#fff3e0
    style websocket-image-events fill:#fff3e0
    style frontend-sidebar-integration fill:#f3e5f5
    style tests-e2e fill:#ffccbc
```

## Tasks by Wave

### Wave 1

- **backend-types-config**: "Add Image/ImageMeta/ImageListItem types and MAX_IMAGE_SIZE, ALLOWED_IMAGE_MIME_TYPES config constants."
- **frontend-types**: "Add Image interface and add 'image' to the Item type union; re-export from the types barrel."
- **session-registry**: "Add 'images' to the resolvePath() artifact kind union so imageManager can resolve its directory."

### Wave 2

- **backend-image-manager**: "New ImageManager service: initialize/create/list/get/getContent/delete over binary files + meta sidecars. Reuses the EmbedManager pattern."
- **frontend-store**: "Add images state slice + actions (setImages, addImage, selectImage, updateImage, removeImage) to the session store."
- **frontend-api-client**: "Add createImage (multipart), listImages, deleteImage methods to the api client."
- **frontend-import-artifact**: "Extend ArtifactType union with 'image'; detect image extensions in detectType; branch inside importArtifact to POST multipart for images while keeping the JSON path for text types."

### Wave 3

- **backend-api-routes**: "Wire imageManager into createManagers(); add POST /api/image (multipart), GET /api/images, GET /api/image/:id, GET /api/image/:id/content (binary stream with Content-Type), DELETE /api/image/:id. Broadcast image_created / image_deleted."
- **backend-mcp-tools**: "MCP tool handlers + schemas for create_image, list_images, get_image, delete_image. Reuses loadImageBytes() from design-ai.ts for source-agnostic loading. Register in setup.ts ListTools + CallTool handlers."
- **frontend-image-viewer**: "New ImageViewer component: render <img> bound to /api/image/:id/content, show metadata and download link."
- **websocket-image-events**: "Handle image_created and image_deleted WebSocket messages: update the session store (addImage / removeImage) so all clients see uploads in real time."

### Wave 4

- **frontend-sidebar-integration**: "Render an Images section in the sidebar using ItemCard; wire onDragOver/onDragLeave/onDrop handlers on the artifact list container to call importArtifact() per file. Highlight the list while dragging. Rely on WebSocket broadcasts to update the store after upload."

### Wave 5

- **tests-e2e**: "Integration test: start test server, POST multipart to /api/image, assert file lands on disk with correct meta, GET /api/image/:id/content returns bytes with correct MIME, DELETE removes both files."
