# Validation Patterns

Consistent validation approaches used throughout the codebase.

## Key Principles

1. **Validation-first**: Check inputs early, fail fast
2. **Descriptive errors**: Include context in error messages
3. **Type safety**: Runtime checks complement TypeScript
4. **Graceful degradation**: Non-critical failures handled silently

## HTTP Status Codes

- **400**: Bad Request (validation failures)
- **404**: Not Found (resource doesn't exist)
- **500**: Internal Server Error