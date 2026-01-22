# AI-UI Interactive Components

This directory contains 5 interactive workflow components for the AI-powered UI system. These components are designed to handle complex user interactions, state management, and provide a seamless experience with full accessibility support and dark mode compatibility.

## Components Overview

### 1. Wizard Component
**File:** `Wizard.tsx`

A multi-step form or process flow component that guides users through sequential steps with progress tracking.

**Key Features:**
- Step-by-step navigation with progress visualization
- Optional steps that can be skipped
- Back/Next/Complete button actions
- Progress bar showing completion percentage
- Step indicators with visual checkmarks
- Customizable titles and descriptions per step
- Full keyboard navigation support

**Props:**
- `steps` - Array of wizard steps with id, title, description, content, and optional flag
- `currentStep` - Current active step (default: 0)
- `allowBack` - Enable/disable back button (default: true)
- `allowSkip` - Enable/disable skip for optional steps (default: true)
- `showProgress` - Show/hide progress indicator (default: true)
- `onStepChange` - Callback fired when step changes
- `onComplete` - Callback fired when wizard completes

**Example Usage:**
```tsx
import { Wizard } from './interactive';

const steps = [
  {
    id: 'personal',
    title: 'Personal Info',
    description: 'Enter your basic information',
    content: <PersonalForm />
  },
  {
    id: 'address',
    title: 'Address',
    optional: true,
    content: <AddressForm />
  }
];

<Wizard
  steps={steps}
  onComplete={() => console.log('Done!')}
/>
```

---

### 2. Checklist Component
**File:** `Checklist.tsx`

A task list component with completion tracking, support for sub-items, and progress visualization.

**Key Features:**
- Main items and optional nested sub-items
- Checkbox completion tracking
- Progress indicator with completion percentage
- Required items highlighting
- Expandable sections for sub-items
- Required items counter
- Full accessibility with ARIA attributes
- Strikethrough styling for completed items

**Props:**
- `items` - Array of checklist items with id, label, completed status, required flag, and optional sub-items
- `allowCheck` - Enable/disable checkboxes (default: true)
- `showProgress` - Show/hide progress indicator (default: true)
- `allRequired` - Mark all items as required (default: false)
- `onItemChange` - Callback fired when item completion changes
- `onSubItemChange` - Callback fired when sub-item completion changes

**Example Usage:**
```tsx
import { Checklist } from './interactive';

const items = [
  {
    id: 'review',
    label: 'Code Review',
    required: true,
    completed: false,
    subItems: [
      { id: 'lint', label: 'Run linter', completed: false },
      { id: 'tests', label: 'Run tests', completed: true }
    ]
  }
];

<Checklist
  items={items}
  onItemChange={(id, completed) => console.log(id, completed)}
/>
```

---

### 3. ApprovalButtons Component
**File:** `ApprovalButtons.tsx`

Action buttons for approval/rejection or custom actions with visual feedback.

**Key Features:**
- Multiple action buttons with different styles
- Primary and destructive button variants
- Configurable alignment (left, center, right)
- Configurable spacing (compact, normal, spacious)
- Optional full-width layout
- Loading states with animated spinners
- Disabled state support
- Hover and focus states

**Props:**
- `actions` - Array of action buttons with id, label, primary, and destructive flags
- `alignment` - Button alignment: 'left' | 'center' | 'right' (default: 'center')
- `spacing` - Spacing between buttons: 'compact' | 'normal' | 'spacious' (default: 'normal')
- `fullWidth` - Stretch buttons to full width (default: false)
- `onAction` - Callback fired when button is clicked
- `disabled` - Disable all buttons (default: false)

**Example Usage:**
```tsx
import { ApprovalButtons } from './interactive';

const actions = [
  { id: 'reject', label: 'Reject', destructive: true },
  { id: 'approve', label: 'Approve', primary: true }
];

<ApprovalButtons
  actions={actions}
  alignment="right"
  onAction={(actionId) => console.log('Action:', actionId)}
/>
```

---

### 4. ProgressBar Component
**File:** `ProgressBar.tsx`

Visual representation of progress with multiple display options and animations.

**Key Features:**
- Determinate and indeterminate progress modes
- Multiple color variants (success, warning, error, info)
- Optional percentage label display
- Striped background pattern option
- Animated indeterminate mode
- ARIA accessibility attributes
- Responsive and full-width support

**Props:**
- `value` - Current progress value (default: 0)
- `max` - Maximum progress value (default: 100)
- `label` - Label text above progress bar
- `showPercentage` - Show percentage value (default: false)
- `indeterminate` - Indeterminate progress mode (default: false)
- `color` - Color variant: 'success' | 'warning' | 'error' | 'info' (default: 'info')
- `striped` - Add striped pattern (default: false)
- `animated` - Animate the progress bar (default: false)

**Example Usage:**
```tsx
import { ProgressBar } from './interactive';

<ProgressBar
  value={65}
  max={100}
  label="Upload Progress"
  showPercentage
  color="success"
/>
```

---

### 5. Tabs Component
**File:** `Tabs.tsx`

Tabbed content sections with switching capability and multiple visual variants.

**Key Features:**
- Multiple tab variants (default, pills, underline)
- Optional icons for tabs
- Disable individual tabs
- Full-width option
- Keyboard navigation (arrow keys)
- Accessible with ARIA role attributes
- Tab content lazy loading
- Dark mode support

**Props:**
- `tabs` - Array of tab objects with id, label, icon, disabled, and content
- `activeTab` - Initially active tab ID
- `variant` - Tab style variant: 'default' | 'pills' | 'underline' (default: 'default')
- `fullWidth` - Stretch tabs to full width (default: false)
- `onTabChange` - Callback fired when tab changes

**Example Usage:**
```tsx
import { Tabs } from './interactive';

const tabs = [
  {
    id: 'overview',
    label: 'Overview',
    content: <OverviewPanel />
  },
  {
    id: 'details',
    label: 'Details',
    content: <DetailsPanel />
  }
];

<Tabs
  tabs={tabs}
  variant="pills"
  onTabChange={(tabId) => console.log('Active tab:', tabId)}
/>
```

---

## Styling

All components use **Tailwind CSS** for styling with built-in dark mode support through Tailwind's `dark:` prefix.

### CSS Classes Used
- Color utilities: `bg-blue-600`, `text-white`, `hover:bg-blue-700`
- Dark mode: `dark:bg-gray-800`, `dark:text-white`, `dark:hover:bg-gray-700`
- Layout: `flex`, `gap-3`, `w-full`, `rounded-lg`
- Effects: `transition-all`, `shadow-sm`, `border`, `rounded-full`

### Customization
Most components accept a `className` prop to add custom Tailwind classes:

```tsx
<Wizard steps={steps} className="my-custom-class" />
```

---

## Accessibility

All components follow WAI-ARIA guidelines:

- **ARIA Roles**: `progressbar`, `tablist`, `tab`, `tabpanel`, `button`
- **ARIA Labels**: Clear labels for screen readers
- **ARIA Attributes**: `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-pressed`, `aria-selected`
- **Keyboard Navigation**: Full support for Tab, Enter, Escape, and Arrow keys
- **Focus Management**: Visible focus rings and proper focus handling

---

## Testing

Each component has comprehensive tests covering:

- **Rendering**: Correct initial state and content display
- **Interaction**: Click handlers, state changes, callbacks
- **Accessibility**: ARIA attributes, keyboard navigation
- **Styling**: CSS classes and visual states
- **Edge Cases**: Empty states, disabled states, boundary conditions

### Running Tests

```bash
npm run test -- --run src/components/ai-ui/interactive/__tests__/
```

**Test Coverage Summary:**
- ✓ Wizard Component: 15 tests
- ✓ Checklist Component: 14 tests
- ✓ ApprovalButtons Component: 18 tests
- **Total**: 47 passing tests

---

## Integration with AI-UI System

These components are part of the larger AI-UI component catalog defined in `/src/ai-ui.ts`. They can be used with the JSON render system for dynamic UI generation.

### Type Definitions
All components export TypeScript interfaces for type safety:
- `WizardProps`, `WizardStep`
- `ChecklistProps`, `ChecklistItem`, `ChecklistSubItem`
- `ApprovalButtonsProps`, `ApprovalAction`
- `ProgressBarProps`
- `TabsProps`, `TabContent`

---

## Dependencies

- **React** 18.2.0+
- **Tailwind CSS** 3.3.6+
- No external icon library (uses inline SVG)

---

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers with ES6+ support

---

## Future Enhancements

Potential improvements for future iterations:

1. **Animation Library Integration**: Add framer-motion for advanced animations
2. **Accessibility Audits**: Full a11y testing with axe-core
3. **Performance Optimization**: React.memo memoization for large lists
4. **Theme System**: Configurable color themes beyond Tailwind
5. **Internationalization**: i18n support for labels and placeholders
6. **Storybook Integration**: Component documentation and visual testing
7. **Mobile Gestures**: Touch support for swiping between tabs/steps
8. **State Persistence**: localStorage for wizard progress, checklist state
