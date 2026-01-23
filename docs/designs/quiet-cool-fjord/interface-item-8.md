# Interface: Item 8 - Fix npm Deprecation Warnings

## [APPROVED]

## File Structure
- `plugins/wireframe/package.json` - Add overrides section

## Changes

### package.json overrides

```json
{
  "name": "mermaid-wireframe",
  "version": "0.1.0",
  // ... existing fields ...
  "overrides": {
    "glob": "^9.0.0",
    "inflight": "npm:lru-cache@^10.0.0"
  }
}
```

**Note:** `nomnom` comes from `jison` which is a dev dependency for parser generation. The parser is pre-built, so this warning only appears during development.

## Alternative: Suppress Warnings

If overrides cause issues, use `.npmrc`:

```
# plugins/wireframe/.npmrc
loglevel=error
```

This hides warnings but doesn't fix the underlying deps.

## Verification
- [ ] No deprecation warnings during npm install
- [ ] Build still works: `npm run build`
- [ ] Tests still pass: `npm test`
