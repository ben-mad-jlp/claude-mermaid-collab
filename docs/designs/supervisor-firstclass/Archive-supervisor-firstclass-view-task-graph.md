# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 13
- **Total waves:** 6
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** esc-store, roadmap-waves
**Wave 2:** esc-ws, supervisor-routes, roadmap-to-mermaid
**Wave 3:** supervisor-store-extend
**Wave 4:** escalation-inbox, roadmap-panel, supervised-region, onboarding
**Wave 5:** supervisor-view-shell
**Wave 6:** notifications-railentry, panel-deeplink

## Task Graph (YAML)

```yaml
tasks:
  - id: esc-store
    files: [src/services/supervisor-store.ts]
    tests: [src/services/__tests__/supervisor-store.test.ts]
    description: "Add listEscalations(status?) + ESCALATION_KINDS const; keep listOpenEscalations as alias"
    parallel: true
    depends-on: []
  - id: roadmap-waves
    files: [src/services/roadmap-store.ts]
    tests: [src/services/__tests__/roadmap-store.test.ts]
    description: "Add computeWaves() topological layering (Kahn, cycle-safe)"
    parallel: true
    depends-on: []
  - id: esc-ws
    files: [src/mcp/setup.ts]
    tests: []
    description: "Broadcast WS escalation_created on NEW escalation only (skip dedup hits)"
    parallel: false
    depends-on: [esc-store]
  - id: supervisor-routes
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/__tests__/supervisor-routes.test.ts]
    description: "GET /escalations?status=, POST /config (write supervisorProject/session), POST /nudge"
    parallel: false
    depends-on: [esc-store]
  - id: roadmap-to-mermaid
    files: [ui/src/components/supervisor/roadmapToMermaid.ts]
    tests: [ui/src/components/supervisor/roadmapToMermaid.test.ts]
    description: "Pure roadmap items -> mermaid flowchart (graph + waves modes, status classDefs)"
    parallel: false
    depends-on: [roadmap-waves]
  - id: supervisor-store-extend
    files: [ui/src/stores/supervisorStore.ts]
    tests: [ui/src/stores/supervisorStore.test.ts]
    description: "Escalation status/history load, nudge() action, config read/write; ensure roadmap load used"
    parallel: false
    depends-on: [supervisor-routes]
  - id: escalation-inbox
    files: [ui/src/components/supervisor/EscalationInbox.tsx]
    tests: []
    description: "Inbox region: kind filter, open/resolved toggle, Jump, Resolve split button"
    parallel: true
    depends-on: [supervisor-store-extend]
  - id: roadmap-panel
    files: [ui/src/components/supervisor/RoadmapPanel.tsx]
    tests: []
    description: "Graph/Waves/List modes; render via diagram engine; node click -> open/spawn"
    parallel: true
    depends-on: [supervisor-store-extend, roadmap-to-mermaid]
  - id: supervised-region
    files: [ui/src/components/supervisor/SupervisedSessions.tsx]
    tests: []
    description: "Grouped region: roadmap link, inline nudge, explicit stop, source tag"
    parallel: true
    depends-on: [supervisor-store-extend]
  - id: onboarding
    files: [ui/src/components/supervisor/SupervisorOnboarding.tsx]
    tests: []
    description: "State A first-run CTA + State C crashed restart; project/session pickers"
    parallel: true
    depends-on: [supervisor-store-extend]
  - id: supervisor-view-shell
    files: [ui/src/components/supervisor/SupervisorView.tsx]
    tests: []
    description: "Home shell: identity bar, 2-column, responsive tabs, A/B/C state switch composing regions"
    parallel: false
    depends-on: [escalation-inbox, roadmap-panel, supervised-region, onboarding]
  - id: notifications-railentry
    files: [ui/src/stores/notificationStore.ts, ui/src/components/layout/Sidebar.tsx, ui/src/components/layout/NavMenu.tsx]
    tests: []
    description: "Toast on escalation_created WS event; left-rail shield entry + open-count badge routing to SupervisorView"
    parallel: true
    depends-on: [supervisor-view-shell, esc-ws]
  - id: panel-deeplink
    files: [ui/src/components/layout/SupervisorPanel.tsx]
    tests: []
    description: "Add 'Open Supervisor' deep-link into the view + start-button label/tooltip"
    parallel: true
    depends-on: [supervisor-view-shell]
```

## Dependency Visualization

```mermaid
graph TD
    esc-store["esc-store<br/>"Add listEscalations(status?) ..."]
    roadmap-waves["roadmap-waves<br/>"Add computeWaves() topologica..."]
    esc-ws["esc-ws<br/>"Broadcast WS escalation_creat..."]
    supervisor-routes["supervisor-routes<br/>"GET /escalations?status=, POS..."]
    roadmap-to-mermaid["roadmap-to-mermaid<br/>"Pure roadmap items -> mermaid..."]
    supervisor-store-extend["supervisor-store-extend<br/>"Escalation status/history loa..."]
    escalation-inbox["escalation-inbox<br/>"Inbox region: kind filter, op..."]
    roadmap-panel["roadmap-panel<br/>"Graph/Waves/List modes; rende..."]
    supervised-region["supervised-region<br/>"Grouped region: roadmap link,..."]
    onboarding["onboarding<br/>"State A first-run CTA + State..."]
    supervisor-view-shell["supervisor-view-shell<br/>"Home shell: identity bar, 2-c..."]
    notifications-railentry["notifications-railentry<br/>"Toast on escalation_created W..."]
    panel-deeplink["panel-deeplink<br/>"Add 'Open Supervisor' deep-li..."]

     --> esc-store
     --> roadmap-waves
    esc-store --> esc-ws
    esc-store --> supervisor-routes
    roadmap-waves --> roadmap-to-mermaid
    supervisor-routes --> supervisor-store-extend
    supervisor-store-extend --> escalation-inbox
    supervisor-store-extend --> roadmap-panel
    roadmap-to-mermaid --> roadmap-panel
    supervisor-store-extend --> supervised-region
    supervisor-store-extend --> onboarding
    escalation-inbox --> supervisor-view-shell
    roadmap-panel --> supervisor-view-shell
    supervised-region --> supervisor-view-shell
    onboarding --> supervisor-view-shell
    supervisor-view-shell --> notifications-railentry
    esc-ws --> notifications-railentry
    supervisor-view-shell --> panel-deeplink

    style esc-store fill:#c8e6c9
    style roadmap-waves fill:#c8e6c9
    style esc-ws fill:#bbdefb
    style supervisor-routes fill:#bbdefb
    style roadmap-to-mermaid fill:#bbdefb
    style supervisor-store-extend fill:#fff3e0
    style escalation-inbox fill:#f3e5f5
    style roadmap-panel fill:#f3e5f5
    style supervised-region fill:#f3e5f5
    style onboarding fill:#f3e5f5
    style supervisor-view-shell fill:#ffccbc
    style notifications-railentry fill:#c8e6c9
    style panel-deeplink fill:#c8e6c9
```

## Tasks by Wave

### Wave 1

- **esc-store**: "Add listEscalations(status?) + ESCALATION_KINDS const; keep listOpenEscalations as alias"
- **roadmap-waves**: "Add computeWaves() topological layering (Kahn, cycle-safe)"

### Wave 2

- **esc-ws**: "Broadcast WS escalation_created on NEW escalation only (skip dedup hits)"
- **supervisor-routes**: "GET /escalations?status=, POST /config (write supervisorProject/session), POST /nudge"
- **roadmap-to-mermaid**: "Pure roadmap items -> mermaid flowchart (graph + waves modes, status classDefs)"

### Wave 3

- **supervisor-store-extend**: "Escalation status/history load, nudge() action, config read/write; ensure roadmap load used"

### Wave 4

- **escalation-inbox**: "Inbox region: kind filter, open/resolved toggle, Jump, Resolve split button"
- **roadmap-panel**: "Graph/Waves/List modes; render via diagram engine; node click -> open/spawn"
- **supervised-region**: "Grouped region: roadmap link, inline nudge, explicit stop, source tag"
- **onboarding**: "State A first-run CTA + State C crashed restart; project/session pickers"

### Wave 5

- **supervisor-view-shell**: "Home shell: identity bar, 2-column, responsive tabs, A/B/C state switch composing regions"

### Wave 6

- **notifications-railentry**: "Toast on escalation_created WS event; left-rail shield entry + open-count badge routing to SupervisorView"
- **panel-deeplink**: "Add 'Open Supervisor' deep-link into the view + start-button label/tooltip"
