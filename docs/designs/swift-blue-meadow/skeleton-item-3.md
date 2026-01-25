# Skeleton: Item 3 - Recreate README

## Planned Files

- [ ] `README.md` - REPLACE (complete rewrite)

## Task Dependency Graph

```yaml
tasks:
  - id: audit-codebase
    files: []
    description: Audit skills, agents, MCP tools, API endpoints
    parallel: true

  - id: write-readme
    files: [README.md]
    description: Write new README from scratch
    depends-on: [audit-codebase]
```

## Execution Order

1. Wave 1: Audit codebase (read-only, gather info)
2. Wave 2: Write README.md

## File Contents

### README.md (structure)

```markdown
# Mermaid Collab

[One-line description]

## Quick Start

### 1. Install
### 2. Start Server
### 3. Use Plugin

## Core Workflow

[Diagram and phase descriptions]

## MCP Tools

[Table of all tools]

## REST API

[Endpoint reference]

## Skills & Agents

[Tables]

## Architecture

[Overview diagram]

## Development

[Dev instructions]
```

## Verification

- [ ] All MCP tools documented
- [ ] All API endpoints documented
- [ ] Installation steps verified
- [ ] No outdated references
