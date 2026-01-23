# Pseudocode: Item 9 - Fix TextArea.tsx onChange Error

## [APPROVED]

## File: ui/src/components/ai-ui/inputs/TextArea.tsx

### Updated Props Interface

```typescript
# BEFORE
interface TextAreaProps {
  onChange: (value: string) => void;  // Required - causes crash
  value?: string;
  name?: string;
  // ...
}

# AFTER
interface TextAreaProps {
  onChange?: (value: string) => void;  // Optional - safe
  value?: string;
  name?: string;
  // ...
}
```

### Internal State for Uncontrolled Mode

```
FUNCTION TextArea({ onChange, value, name, placeholder, rows, disabled }):
  # Track value internally for uncontrolled mode
  [internalValue, setInternalValue] = useState(value || "")
  
  # Sync with prop when provided (controlled mode)
  useEffect(() => {
    IF value !== undefined:
      setInternalValue(value)
  }, [value])
  
  # Return internal value for display
  displayValue = internalValue
```

### Updated Change Handler

```
FUNCTION handleChange(event):
  newValue = event.target.value
  
  # Always update internal state
  setInternalValue(newValue)
  
  # Call onChange only if provided (optional chaining)
  onChange?.(newValue)
  
  # Form data collected via name attribute on submit
  # No onChange needed for form collection to work
```

### Full Component Flow

```
FUNCTION TextArea(props):
  { onChange, value, name, placeholder, rows = 4, disabled, className } = props
  
  # Internal state
  [internalValue, setInternalValue] = useState(value || "")
  
  # Sync external value changes
  useEffect(() => {
    IF value !== undefined:
      setInternalValue(value)
  }, [value])
  
  # Handle changes
  handleChange = (e) => {
    newValue = e.target.value
    setInternalValue(newValue)
    onChange?.(newValue)  # Safe - optional chaining
  }
  
  # Render
  RETURN (
    <textarea
      name={name}
      value={internalValue}
      onChange={handleChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={className}
    />
  )
```

### Error Case (Before Fix)

```
# This crashed because onChange was undefined
handleChange = (e) => {
  newValue = e.target.value
  onChange(newValue)  # TypeError: onChange is not a function
}
```

## Verification
- [ ] onChange is optional in props interface
- [ ] Internal state tracks value
- [ ] handleChange uses optional chaining: onChange?.(newValue)
- [ ] Component works without onChange prop
- [ ] Form data still collected via name attribute
