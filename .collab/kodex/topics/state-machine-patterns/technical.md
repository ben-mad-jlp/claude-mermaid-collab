## Implementation Patterns

### Exhaustive Transition Evaluation
```typescript
function evaluateCondition(condition, context): boolean {
  switch (condition.type) {
    case 'item_type':
      return context.currentItemType === condition.value;
    case 'no_items_remaining':
      return !context.itemsRemaining;
    // ... exhaustive handling
  }
}
```

### Max Iteration Safety
```typescript
function resolveToSkillState(startStateId, context, maxIterations = 10) {
  // Prevents infinite loops in routing nodes
  while (iterations < maxIterations) {
    // ... traverse routing nodes
  }
  throw new Error(`Max iterations reached`);
}
```

### Type-Safe State IDs
Using union types for `StateId` ensures compile-time checking of valid states.