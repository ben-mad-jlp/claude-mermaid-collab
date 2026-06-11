# React Patterns

Common React patterns used throughout the mermaid-collab UI codebase.

## State Management

- **Zustand Stores**: Lightweight state management with `useShallow` for selective subscriptions
- **Local State**: `useState` for component-specific state
- **Refs**: `useRef` for imperative handles and mutable values

## Component Patterns

- **Compound Components**: Related components exported together (e.g., mobile components)
- **Render Props**: Flexible content rendering (e.g., SplitPane)
- **Error Boundaries**: Class components for error catching
- **Controlled Inputs**: Form state managed by parent

## Performance Patterns

- **Memoization**: `useMemo` for expensive computations, `useCallback` for stable references
- **Selective Subscriptions**: `useShallow` to prevent unnecessary re-renders
- **Lazy Loading**: Dynamic imports for code splitting