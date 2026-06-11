# Error Patterns

Consistent error handling patterns used throughout the codebase.

## Custom Error Classes

- **MermaidError**: Custom error with optional `cause` property for Mermaid operations
- **APIError**: Interface extending Error with `status` and `data` properties

## Error Response Format

API errors follow consistent JSON format:
```json
{ "error": "Error message" }
```

With HTTP status codes:
- **400**: Bad Request (validation failures)
- **404**: Not Found
- **500**: Internal Server Error