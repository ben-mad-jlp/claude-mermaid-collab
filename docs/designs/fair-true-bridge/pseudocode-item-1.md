# Pseudocode: Item 1 - Build 10 new AI-UI components

## APPROVED

## RadioGroup

```
FUNCTION RadioGroup(props):
  id = useId()
  internalValue = useState(props.value || '')
  
  currentValue = props.value !== undefined ? props.value : internalValue
  
  FUNCTION handleChange(newValue):
    setInternalValue(newValue)
    IF props.onChange THEN props.onChange(newValue)
  
  RENDER:
    Container with role="radiogroup" aria-label={props.ariaLabel || props.label}
    IF props.label THEN render label element
    
    FOR each option in props.options:
      Radio input with:
        - type="radio"
        - name={props.name}
        - value={option.value}
        - checked={currentValue === option.value}
        - disabled={props.disabled || option.disabled}
        - onChange={() => handleChange(option.value)}
      Label for radio
    
    Layout based on orientation (flex-row vs flex-col)
```

## Toggle

```
FUNCTION Toggle(props):
  id = useId()
  internalChecked = useState(props.checked || false)
  
  currentChecked = props.checked !== undefined ? props.checked : internalChecked
  
  FUNCTION handleToggle():
    IF props.disabled THEN return
    newValue = !currentChecked
    setInternalChecked(newValue)
    IF props.onChange THEN props.onChange(newValue)
  
  RENDER:
    Container with flex layout
    IF props.label THEN render label
    
    Hidden checkbox input with:
      - type="checkbox"
      - name={props.name}
      - checked={currentChecked}
      - onChange={handleToggle}
      - disabled={props.disabled}
    
    Toggle track (button):
      - role="switch"
      - aria-checked={currentChecked}
      - onClick={handleToggle}
      - Size classes based on props.size (sm/md/lg)
      - Background: blue when checked, gray when not
      
    Toggle knob (span inside track):
      - Transform translate based on checked state
      - Transition for smooth animation
```

## NumberInput

```
FUNCTION NumberInput(props):
  id = useId()
  internalValue = useState(props.value ?? '')
  
  currentValue = props.value !== undefined ? props.value : internalValue
  
  FUNCTION handleChange(e):
    rawValue = e.target.value
    IF rawValue is empty:
      setInternalValue('')
      IF props.onChange THEN props.onChange(undefined)
      return
    
    numValue = parseFloat(rawValue)
    IF isNaN(numValue) THEN return
    
    clampedValue = clamp(numValue, props.min, props.max)
    setInternalValue(clampedValue)
    IF props.onChange THEN props.onChange(clampedValue)
  
  FUNCTION handleStep(direction):
    step = props.step || 1
    newValue = (currentValue || 0) + (direction * step)
    clampedValue = clamp(newValue, props.min, props.max)
    setInternalValue(clampedValue)
    IF props.onChange THEN props.onChange(clampedValue)
  
  RENDER:
    Container with flex-col
    IF props.label THEN render label
    
    Input group with:
      Decrement button (onClick={() => handleStep(-1)))
      Input element:
        - type="number"
        - name={props.name}
        - value={currentValue}
        - min/max/step from props
        - onChange={handleChange}
        - disabled={props.disabled}
      Increment button (onClick={() => handleStep(1)))
```

## Slider

```
FUNCTION Slider(props):
  id = useId()
  min = props.min ?? 0
  max = props.max ?? 100
  step = props.step ?? 1
  internalValue = useState(props.value ?? min)
  
  currentValue = props.value !== undefined ? props.value : internalValue
  
  FUNCTION handleChange(e):
    numValue = parseFloat(e.target.value)
    setInternalValue(numValue)
    IF props.onChange THEN props.onChange(numValue)
  
  percentage = ((currentValue - min) / (max - min)) * 100
  
  RENDER:
    Container with flex-col
    IF props.label THEN render label with optional value display
    
    Slider wrapper:
      Range input:
        - type="range"
        - name={props.name}
        - min/max/step
        - value={currentValue}
        - onChange={handleChange}
        - disabled={props.disabled}
        - Custom styling via CSS (track and thumb)
      
    IF props.showValue THEN render value display
```

## FileUpload

```
FUNCTION FileUpload(props):
  id = useId()
  inputRef = useRef(null)
  dragActive = useState(false)
  selectedFiles = useState(null)
  error = useState(null)
  
  FUNCTION validateFiles(files):
    IF props.maxSize:
      FOR each file in files:
        IF file.size > props.maxSize:
          return { valid: false, error: "File too large" }
    return { valid: true }
  
  FUNCTION handleFiles(files):
    validation = validateFiles(files)
    IF not validation.valid:
      setError(validation.error)
      return
    
    setError(null)
    setSelectedFiles(files)
    IF props.onChange THEN props.onChange(files)
  
  FUNCTION handleDrop(e):
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  
  FUNCTION handleDragOver(e):
    e.preventDefault()
    setDragActive(true)
  
  FUNCTION handleDragLeave():
    setDragActive(false)
  
  FUNCTION handleInputChange(e):
    handleFiles(e.target.files)
  
  RENDER:
    Container
    IF props.label THEN render label
    
    Drop zone (div):
      - onClick={() => inputRef.current.click()}
      - onDrop={handleDrop}
      - onDragOver={handleDragOver}
      - onDragLeave={handleDragLeave}
      - Border style changes when dragActive
      - Upload icon and text
      - Shows selected file names if any
    
    Hidden file input:
      - ref={inputRef}
      - type="file"
      - name={props.name}
      - accept={props.accept}
      - multiple={props.multiple}
      - onChange={handleInputChange}
      - disabled={props.disabled}
    
    IF error THEN render error message
```

## Image

```
FUNCTION Image(props):
  RENDER:
    Figure container (if caption) or div
    
    img element:
      - src={props.src}
      - alt={props.alt}
      - width/height from props
      - style={{ objectFit: props.objectFit || 'contain' }}
      - className={props.className}
    
    IF props.caption:
      figcaption with caption text
```

## Spinner

```
FUNCTION Spinner(props):
  sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  }
  
  size = props.size || 'md'
  
  RENDER:
    Container with flex and items-center
    
    SVG spinner:
      - className includes sizeClasses[size] and 'animate-spin'
      - Circle with stroke for track
      - Arc path with stroke for spinning indicator
    
    IF props.label:
      Span with label text, sr-only for accessibility
```

## Badge

```
FUNCTION Badge(props):
  variantClasses = {
    default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  }
  
  sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-0.5 text-sm',
    lg: 'px-3 py-1 text-base'
  }
  
  variant = props.variant || 'default'
  size = props.size || 'md'
  
  RENDER:
    Span with:
      - inline-flex rounded-full font-medium
      - variantClasses[variant]
      - sizeClasses[size]
      - props.className
      - text: props.text
```

## Divider

```
FUNCTION Divider(props):
  orientation = props.orientation || 'horizontal'
  
  IF orientation is 'horizontal':
    RENDER:
      Div with flex items-center
      IF props.label:
        Span (line) with flex-1 h-px bg-gray-200 dark:bg-gray-700
        Span with label text, px-3 text-sm text-gray-500
        Span (line) with flex-1 h-px bg-gray-200 dark:bg-gray-700
      ELSE:
        Single hr with w-full border-gray-200 dark:border-gray-700
  
  ELSE (vertical):
    RENDER:
      Div with inline-flex flex-col items-center h-full
      IF props.label:
        Span (line) with flex-1 w-px bg-gray-200
        Span with label text rotated -90deg
        Span (line) with flex-1 w-px bg-gray-200
      ELSE:
        Single div with w-px h-full bg-gray-200
```

## Link

```
FUNCTION Link(props):
  variantClasses = {
    default: 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
    primary: 'text-blue-600 hover:underline font-medium',
    subtle: 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
  }
  
  variant = props.variant || 'default'
  
  FUNCTION handleClick(e):
    IF props.disabled:
      e.preventDefault()
      return
    IF props.onClick:
      e.preventDefault()
      props.onClick()
  
  RENDER:
    Anchor element:
      - href={props.href || '#'}
      - onClick={handleClick}
      - target={props.external ? '_blank' : undefined}
      - rel={props.external ? 'noopener noreferrer' : undefined}
      - className includes variantClasses[variant], disabled styles
      - aria-disabled={props.disabled}
      
      Span with props.label
      IF props.external:
        External link icon (small arrow)
```
