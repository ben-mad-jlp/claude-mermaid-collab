# Claude Code Instructions for mermaid-collab

## Versioning

**Always use npm version for version updates:**

```bash
npm version patch   # 5.19.0 → 5.19.1 (bug fixes)
npm version minor   # 5.19.0 → 5.20.0 (new features)
npm version major   # 5.19.0 → 6.0.0 (breaking changes)
```

This automatically:
1. Updates `package.json`
2. Syncs version to `.claude-plugin/plugin.json` (via postversion hook)
3. Syncs version to `.claude-plugin/marketplace.json` (via postversion hook)
4. Syncs version to `src/mcp/server.ts` SERVER_VERSION const (via postversion hook)
5. Creates a git commit and tag

After running `npm version`, push with:
```bash
git push && git push --tags
```

**Never manually edit version numbers** in package.json, plugin.json, marketplace.json, or server.ts.

## Testing

Use `test:ci` for non-interactive test runs (exits after completion):
```bash
npm run test:ci           # Run all UI tests
npm run test:ci -- path   # Run specific test file
```

Use `test` for interactive watch mode during development.

## Project Structure

- `src/` - Backend server and MCP
- `ui/` - React frontend
- `skills/` - Claude Code skill definitions
- `.claude-plugin/` - Plugin configuration
- `plugins/wireframe/` - Wireframe diagram plugin
