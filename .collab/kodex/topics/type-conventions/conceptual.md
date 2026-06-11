# Type Conventions

This codebase uses TypeScript with strict mode enabled. Types are organized in dedicated files with central exports.

## Interfaces vs Types

- **Interfaces**: Used for domain models, component props, store state, API responses, configuration objects
- **Types**: Used for union types, callback signatures, literal unions, simple aliases

## Naming Conventions

| Pattern | Usage | Example |
|---------|-------|--------|
| `[Name]Props` | Component props | `CodeBlockProps`, `CardProps` |
| `[Name]State` | Store state | `SessionState`, `UIState` |
| `Use[Name]Return` | Hook returns | `UseDiagramReturn`, `UseWebSocketReturn` |
| `[Name]Response` | API responses | `QuestionResponse`, `UIResponse` |
| `[Name]Params` | Function parameters | `RenderUIParams`, `DismissUIParams` |

## Common Patterns

- **Partial types** for updates: `Partial<Diagram>`
- **Discriminated unions**: `type: 'diagram' | 'document'`
- **Generic Record**: `Record<string, T>`
- **as const** for literal types in config objects