# Interface Definition: Item 1 - Build 10 new AI-UI components

## APPROVED

## File Structure

**Inputs (5 components):**
- `ui/src/components/ai-ui/inputs/RadioGroup.tsx`
- `ui/src/components/ai-ui/inputs/Toggle.tsx`
- `ui/src/components/ai-ui/inputs/NumberInput.tsx`
- `ui/src/components/ai-ui/inputs/Slider.tsx`
- `ui/src/components/ai-ui/inputs/FileUpload.tsx`

**Display (3 components):**
- `ui/src/components/ai-ui/display/Image.tsx`
- `ui/src/components/ai-ui/display/Spinner.tsx`
- `ui/src/components/ai-ui/display/Badge.tsx`

**Layout (1 component):**
- `ui/src/components/ai-ui/layout/Divider.tsx`

**Interactive (1 component):**
- `ui/src/components/ai-ui/interactive/Link.tsx`

---

## Type Definitions

### RadioGroup

```typescript
// ui/src/components/ai-ui/inputs/RadioGroup.tsx
interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface RadioGroupProps {
  options?: RadioOption[];
  onChange?: (value: string) => void;
  value?: string;
  name?: string;
  label?: string;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  ariaLabel?: string;
}
```

### Toggle

```typescript
// ui/src/components/ai-ui/inputs/Toggle.tsx
interface ToggleProps {
  onChange?: (checked: boolean) => void;
  checked?: boolean;
  name?: string;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
}
```

### NumberInput

```typescript
// ui/src/components/ai-ui/inputs/NumberInput.tsx
interface NumberInputProps {
  onChange?: (value: number) => void;
  value?: number;
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}
```

### Slider

```typescript
// ui/src/components/ai-ui/inputs/Slider.tsx
interface SliderProps {
  onChange?: (value: number) => void;
  value?: number;
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  ariaLabel?: string;
}
```

### FileUpload

```typescript
// ui/src/components/ai-ui/inputs/FileUpload.tsx
interface FileUploadProps {
  onChange?: (files: FileList | null) => void;
  name?: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  maxSize?: number;
  ariaLabel?: string;
}
```

### Image

```typescript
// ui/src/components/ai-ui/display/Image.tsx
interface ImageProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
}
```

### Spinner

```typescript
// ui/src/components/ai-ui/display/Spinner.tsx
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}
```

### Badge

```typescript
// ui/src/components/ai-ui/display/Badge.tsx
interface BadgeProps {
  text: string;
  variant?: 'default' | 'info' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
```

### Divider

```typescript
// ui/src/components/ai-ui/layout/Divider.tsx
interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  label?: string;
  className?: string;
}
```

### Link

```typescript
// ui/src/components/ai-ui/interactive/Link.tsx
interface LinkProps {
  href?: string;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'subtle';
  disabled?: boolean;
  external?: boolean;
  className?: string;
}
```

---

## Function Signatures

Each component exports:

```typescript
// Pattern for all components
export const ComponentName: React.FC<ComponentNameProps> = (props) => { ... }
ComponentName.displayName = 'ComponentName';
```

---

## Component Interactions

- All input components support `name` prop for form data collection via `renderer.tsx`
- All input components use internal state (uncontrolled) with optional controlled mode
- All components support `disabled` prop propagated from `renderer.tsx`
- Components render as children inside `Card`, `Section`, or other layout components
