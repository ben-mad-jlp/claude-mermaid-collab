# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 2
- **Total waves:** 2
- **Max parallelism:** 1

## Execution Waves

**Wave 1:** config-service
**Wave 2:** xai-via-config

## Task Graph (YAML)

```yaml
tasks:
  - id: config-service
    files: [src/services/config-service.ts]
    tests: [src/services/__tests__/config-service.test.ts]
    description: "NEW config service: getConfig(key, fallback?) precedence env -> ~/.mermaid-collab/config.json -> fallback; cached safe file load (missing/malformed -> {}); configPath() honors MERMAID_CONFIG_PATH for tests; _resetConfigCache(). bun:test cases: env-wins, file-fallback, absent->fallback, malformed->no-throw, empty-env->file."
    parallel: true
    depends-on: []
  - id: xai-via-config
    files: [src/mcp/setup.ts]
    tests: []
    description: "Route consult_grok's XAI_API_KEY read through getConfig('XAI_API_KEY') (import from ../services/config-service). Keep the existing not-set guard. One-line swap; fixes the desktop XAI bug (server reads key from global config.json regardless of launch)."
    parallel: false
    depends-on: [config-service]
```

## Dependency Visualization

```mermaid
graph TD
    config-service["config-service<br/>"NEW config service: getConfig..."]
    xai-via-config["xai-via-config<br/>"Route consult_grok's XAI_API_..."]

     --> config-service
    config-service --> xai-via-config

    style config-service fill:#c8e6c9
    style xai-via-config fill:#bbdefb
```

## Tasks by Wave

### Wave 1

- **config-service**: "NEW config service: getConfig(key, fallback?) precedence env -> ~/.mermaid-collab/config.json -> fallback; cached safe file load (missing/malformed -> {}); configPath() honors MERMAID_CONFIG_PATH for tests; _resetConfigCache(). bun:test cases: env-wins, file-fallback, absent->fallback, malformed->no-throw, empty-env->file."

### Wave 2

- **xai-via-config**: "Route consult_grok's XAI_API_KEY read through getConfig('XAI_API_KEY') (import from ../services/config-service). Keep the existing not-set guard. One-line swap; fixes the desktop XAI bug (server reads key from global config.json regardless of launch)."
