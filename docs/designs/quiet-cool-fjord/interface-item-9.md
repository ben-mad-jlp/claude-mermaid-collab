# Interface: Item 9 - Fix TextArea.tsx onChange Error

## [APPROVED]

## File Structure
- `ui/src/components/ai-ui/inputs/TextArea.tsx` - Fix onChange handling

## Type Definitions

```typescript
// BEFORE
export interface TextAreaProps {
  onChange: (value: string) => void;  // Required
  // ...
}

// AFTER
export interface TextAreaProps {
  onChange?: (value: string) => void;  // Optional
  name?: string;  // For form collection
  // ...
}
```

## Function Signatures

```typescript
// ui/src/components/ai-ui/inputs/TextArea.tsx

// Line 38-46 - BEFORE
const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newValue = e.target.value;
  onChange(newValue);  // Crashes if onChange is undefined
  // ...
};

// Line 38-46 - AFTER
const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newValue = e.target.value;
  setInternalValue(newValue);  // Track internally
  onChange?.(newValue);  // Optional chaining - safe if undefined
  // ...
};
```

## Additional Changes

Add internal state for uncontrolled mode:

```typescript
const [internalValue, setInternalValue] = useState(value);

// Use internalValue for display, sync with prop when provided
useEffect(() => {
  if (value !== undefined) {
    setInternalValue(value);
  }
}, [value]);
```

## Verification
- [ ] onChange is optional in props interface
- [ ] handleChange uses optional chaining
- [ ] Component works in uncontrolled mode (no onChange)
- [ ] Form data collected via name attribute
