# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 5
- **Total waves:** 2
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** ws-client-id, server-relay-sender, silent-catch-logging
**Wave 2:** api-client-id-header, client-echo-filter

## Task Graph (YAML)

```yaml
tasks:
  - id: ws-client-id
    files: [ui/src/lib/websocket.ts]
    tests: []
    description: "Add clientId property to WebSocketClient class"
    parallel: true
    depends-on: []
  - id: api-client-id-header
    files: [ui/src/lib/api.ts]
    tests: [ui/src/lib/api.test.ts]
    description: "Send X-Client-Id header on updateDesign requests"
    parallel: false
    depends-on: [ws-client-id]
  - id: server-relay-sender
    files: [src/websocket/handler.ts, src/routes/api.ts]
    tests: []
    description: "Add sender field to WSMessage type and relay X-Client-Id in design_updated broadcast"
    parallel: true
    depends-on: []
  - id: client-echo-filter
    files: [ui/src/App.tsx]
    tests: []
    description: "Skip design_updated messages where sender matches own clientId"
    parallel: false
    depends-on: [ws-client-id, server-relay-sender]
  - id: silent-catch-logging
    files: [ui/src/hooks/useDesignSync.ts]
    tests: []
    description: "Add console.warn to silent catch blocks in deserialization"
    parallel: true
    depends-on: []
```

## Dependency Visualization

```mermaid
graph TD
    ws-client-id["ws-client-id<br/>"Add clientId property to WebS..."]
    api-client-id-header["api-client-id-header<br/>"Send X-Client-Id header on up..."]
    server-relay-sender["server-relay-sender<br/>"Add sender field to WSMessage..."]
    client-echo-filter["client-echo-filter<br/>"Skip design_updated messages ..."]
    silent-catch-logging["silent-catch-logging<br/>"Add console.warn to silent ca..."]

     --> ws-client-id
    ws-client-id --> api-client-id-header
     --> server-relay-sender
    ws-client-id --> client-echo-filter
    server-relay-sender --> client-echo-filter
     --> silent-catch-logging

    style ws-client-id fill:#c8e6c9
    style server-relay-sender fill:#c8e6c9
    style silent-catch-logging fill:#c8e6c9
    style api-client-id-header fill:#bbdefb
    style client-echo-filter fill:#bbdefb
```

## Tasks by Wave

### Wave 1

- **ws-client-id**: "Add clientId property to WebSocketClient class"
- **server-relay-sender**: "Add sender field to WSMessage type and relay X-Client-Id in design_updated broadcast"
- **silent-catch-logging**: "Add console.warn to silent catch blocks in deserialization"

### Wave 2

- **api-client-id-header**: "Send X-Client-Id header on updateDesign requests"
- **client-echo-filter**: "Skip design_updated messages where sender matches own clientId"
