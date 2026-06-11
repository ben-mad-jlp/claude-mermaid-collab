# Collab Flow

Collab flow manages structured collaboration sessions between Claude and users for feature development, bugfixes, and tasks. Sessions progress through defined phases with state persistence.

## Session Lifecycle

1. **Session Creation**: Generate memorable name (adjective-adjective-noun), create directory structure
2. **Goal Gathering**: Collect and classify work items (code/task/bugfix)
3. **Brainstorming**: Explore, clarify, design, and validate each item
4. **Rough-Draft** (code items): Define interfaces, pseudocode, skeleton, task graph
5. **Implementation**: Execute tasks in dependency order
6. **Completion**: Finish development branch, archive or cleanup

## Work Item Types

- **code**: Feature implementation requiring TDD and design
- **task**: Operational tasks (docker, installs) skipping TDD
- **bugfix**: Bug investigation using systematic debugging

## State Management

Session state is persisted in `.collab/sessions/<name>/collab-state.json` and tracked via MCP tools.