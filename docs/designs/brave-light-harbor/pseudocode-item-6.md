# Pseudocode: Item 6 - Replace RadioGroup with Dropdown

## Dropdown Component

```
FUNCTION Dropdown({ name, label, options, placeholder, required, defaultValue, onChange }):
  [value, setValue] = useState(defaultValue || '')
  
  FUNCTION handleChange(e):
    newValue = e.target.value
    setValue(newValue)
    IF onChange:
      onChange(newValue)
  
  RETURN (
    <div className="dropdown-field">
      IF label:
        <label htmlFor={name}>{label}</label>
      
      <select
        id={name}
        name={name}
        value={value}
        onChange={handleChange}
        required={required}
        className="dropdown-select"
      >
        IF placeholder:
          <option value="" disabled>{placeholder}</option>
        
        FOR option IN options:
          <option 
            key={option.value} 
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
      </select>
    </div>
  )
```

## ComponentRenderer Update

```
FUNCTION ComponentRenderer({ ui, onFormChange }):
  SWITCH ui.type:
    CASE 'Dropdown':
      RETURN (
        <Dropdown
          name={ui.props.name}
          label={ui.props.label}
          options={ui.props.options}
          placeholder={ui.props.placeholder}
          onChange={(value) => onFormChange(ui.props.name, value)}
        />
      )
    
    CASE 'RadioGroup':
      # Keep for backwards compatibility
      RETURN <RadioGroup {...ui.props} />
    
    # ... other cases
```

## AI-UI Component Export

```
# ui/src/components/ai-ui/index.ts

export { Dropdown } from './Dropdown'
export { RadioGroup } from './RadioGroup'  # Keep available
# ... other exports
```

## Usage Comparison

```
# Before (RadioGroup):
{
  "type": "RadioGroup",
  "props": {
    "name": "choice",
    "options": [
      { "value": "1", "label": "Option 1" },
      { "value": "2", "label": "Option 2" }
    ]
  }
}

# After (Dropdown):
{
  "type": "Dropdown",
  "props": {
    "name": "choice",
    "placeholder": "Select an option",
    "options": [
      { "value": "1", "label": "Option 1" },
      { "value": "2", "label": "Option 2" }
    ]
  }
}
```

## Styling

```css
.dropdown-select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--input-bg);
  color: var(--text-color);
  font-size: 0.875rem;
}

.dropdown-select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--primary-color-light);
}
```
