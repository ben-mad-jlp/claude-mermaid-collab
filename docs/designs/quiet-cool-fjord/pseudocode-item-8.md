# Pseudocode: Item 8 - Fix npm Deprecation Warnings

## [APPROVED]

## File: plugins/wireframe/package.json

### Add Overrides Section

```
CURRENT package.json structure:
{
  "name": "mermaid-wireframe",
  "version": "0.1.0",
  "dependencies": { ... },
  "devDependencies": { ... }
}

ADD overrides section:
{
  "name": "mermaid-wireframe",
  "version": "0.1.0",
  "dependencies": { ... },
  "devDependencies": { ... },
  "overrides": {
    "glob": "^10.0.0",
    "inflight": "npm:@pnpm/npm-lifecycle@2.0.0"
  }
}
```

### Rationale

```
DEPRECATION CHAIN:
  inflight@1.0.6 (deprecated)
    ← glob@8.1.0
      ← @rollup/plugin-commonjs
        ← rollup (dev dependency)

  nomnom@1.5.2 (deprecated)
    ← jison@0.4.18 (parser generator)
      ← used during development only

SOLUTIONS:
  1. glob: Override to v10 which doesn't use inflight
  2. inflight: Replace with npm alias to alternative package
  3. nomnom: Can't easily override, but jison is dev-only
```

### Alternative: Suppress Warnings

```
IF overrides cause compatibility issues:

CREATE plugins/wireframe/.npmrc:
  loglevel=error

This hides warnings but doesn't fix underlying deps.
Use as fallback only.
```

### Testing Process

```
FUNCTION verifyFix():
  # Clean install
  cd plugins/wireframe
  rm -rf node_modules package-lock.json
  
  # Install and check for warnings
  npm install 2>&1 | grep -i "deprecated"
  
  IF deprecation warnings found:
    FAIL "Deprecation warnings still present"
  
  # Verify build still works
  npm run build
  IF build fails:
    FAIL "Build broken by overrides"
  
  # Verify tests pass
  npm test
  IF tests fail:
    FAIL "Tests broken by overrides"
  
  PASS "No deprecation warnings, build and tests pass"
```

## Verification
- [ ] No deprecation warnings during npm install
- [ ] package.json has overrides section
- [ ] Build still works: npm run build
- [ ] Tests still pass: npm test
