# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 6
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** header-strip-dropdowns, sidebar-servers-section, modal-add-project
**Wave 2:** header-remove-server-switcher, modal-add-session
**Wave 3:** modal-cleanup-and-back-compat

## Task Graph (YAML)

```yaml
tasks:
  - id: header-strip-dropdowns
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Replace project + session <select>s in Header with non-interactive labels (project basename + session name). Keep ServerSwitcher mount + theme/zoom/VSCode pill in place for now."
    parallel: true
    depends-on: []
  - id: sidebar-servers-section
    files: []
    tests: []
    description: "New ServersTreeSection above Watching: icon + label + host:port + status dot per row; click switches active; manual add-server form; manual remove. Reuse shape/affordances from ServerSwitcher; coexist with the header mount until Task C."
    parallel: true
    depends-on: []
  - id: modal-add-project
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Under each server group in the Subscribe modal, add `+ New project` that posts a new project path via mc.invokeOnServer (or falls back to lazy create via the next session POST) and refreshes the server group."
    parallel: true
    depends-on: []
  - id: header-remove-server-switcher
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Cleanup pass: remove the <ServerSwitcher /> mount + import from Header now that the sidebar Servers section owns selection. Layout settles without the dropdown's width contribution."
    parallel: false
    depends-on: [header-strip-dropdowns, sidebar-servers-section]
  - id: modal-add-session
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Under each project in the modal, add `+ New session` that posts /api/sessions via mc.invokeOnServer and auto-subscribes to the new session. Plays nicely with cross-server fan-out (no active-server switch)."
    parallel: false
    depends-on: [modal-add-project]
  - id: modal-cleanup-and-back-compat
    files: []
    tests: []
    description: "Final pass: tighten modal layout after Tasks D/E; if no remaining importers, delete ServerSwitcher.tsx (its surface is fully owned by ServersTreeSection now). Document the new mental model briefly in a file-header comment."
    parallel: false
    depends-on: [header-remove-server-switcher, modal-add-session, sidebar-servers-section]
```

## Dependency Visualization

```mermaid
graph TD
    header-strip-dropdowns["header-strip-dropdowns<br/>"Replace project + session <se..."]
    sidebar-servers-section["sidebar-servers-section<br/>"New ServersTreeSection above ..."]
    modal-add-project["modal-add-project<br/>"Under each server group in th..."]
    header-remove-server-switcher["header-remove-server-switcher<br/>"Cleanup pass: remove the <Ser..."]
    modal-add-session["modal-add-session<br/>"Under each project in the mod..."]
    modal-cleanup-and-back-compat["modal-cleanup-and-back-compat<br/>"Final pass: tighten modal lay..."]

     --> header-strip-dropdowns
     --> sidebar-servers-section
     --> modal-add-project
    header-strip-dropdowns --> header-remove-server-switcher
    sidebar-servers-section --> header-remove-server-switcher
    modal-add-project --> modal-add-session
    header-remove-server-switcher --> modal-cleanup-and-back-compat
    modal-add-session --> modal-cleanup-and-back-compat
    sidebar-servers-section --> modal-cleanup-and-back-compat

    style header-strip-dropdowns fill:#c8e6c9
    style sidebar-servers-section fill:#c8e6c9
    style modal-add-project fill:#c8e6c9
    style header-remove-server-switcher fill:#bbdefb
    style modal-add-session fill:#bbdefb
    style modal-cleanup-and-back-compat fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **header-strip-dropdowns**: "Replace project + session <select>s in Header with non-interactive labels (project basename + session name). Keep ServerSwitcher mount + theme/zoom/VSCode pill in place for now."
- **sidebar-servers-section**: "New ServersTreeSection above Watching: icon + label + host:port + status dot per row; click switches active; manual add-server form; manual remove. Reuse shape/affordances from ServerSwitcher; coexist with the header mount until Task C."
- **modal-add-project**: "Under each server group in the Subscribe modal, add `+ New project` that posts a new project path via mc.invokeOnServer (or falls back to lazy create via the next session POST) and refreshes the server group."

### Wave 2

- **header-remove-server-switcher**: "Cleanup pass: remove the <ServerSwitcher /> mount + import from Header now that the sidebar Servers section owns selection. Layout settles without the dropdown's width contribution."
- **modal-add-session**: "Under each project in the modal, add `+ New session` that posts /api/sessions via mc.invokeOnServer and auto-subscribes to the new session. Plays nicely with cross-server fan-out (no active-server switch)."

### Wave 3

- **modal-cleanup-and-back-compat**: "Final pass: tighten modal layout after Tasks D/E; if no remaining importers, delete ServerSwitcher.tsx (its surface is fully owned by ServersTreeSection now). Document the new mental model briefly in a file-header comment."
