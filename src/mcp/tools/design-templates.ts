/**
 * Design Templates & Tokens
 *
 * Pre-built UI templates and design token presets for rapid design creation.
 * Templates return tree specs compatible with create_design_from_tree.
 */

import { handleCreateDesignFromTree } from './design-ai'
import { handleGetDesign, handleUpdateDesign } from './design'

// ============= Types =============

interface TreeSpec {
  type: string
  name?: string
  ref?: string
  children?: TreeSpec[]
  [key: string]: any
}

interface TokenSet {
  colors: Record<string, string>
  typography: Record<string, { fontSize: number; fontWeight: number; lineHeight?: number }>
  spacing: Record<string, number>
  radii: Record<string, number>
}

// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name.' },
}

export const createFromTemplateSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    parentId: { type: 'string', description: 'Parent node ID. Defaults to first page.' },
    template: {
      type: 'string',
      enum: ['navbar', 'card', 'button', 'input', 'list-item', 'avatar', 'badge', 'modal', 'tab-bar', 'form'],
      description: 'Template name',
    },
    params: {
      type: 'object',
      description: 'Template customization params. Varies by template. Common: title, subtitle, fill, width, height, items[].',
    },
  },
  required: ['project', 'designId', 'template'],
}

export const createDesignTokensSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    preset: {
      type: 'string',
      enum: ['material', 'ios', 'minimal-dark', 'minimal-light'],
      description: 'Token preset name. Omit to provide custom tokens.',
    },
    custom: {
      type: 'object',
      description: 'Custom token set: { colors: {name: hex}, typography: {name: {fontSize, fontWeight}}, spacing: {name: number}, radii: {name: number} }',
    },
  },
  required: ['project', 'designId'],
}

export const applyDesignTokensSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Node ID to apply tokens to' },
    bindings: {
      type: 'object',
      description: 'Variable bindings: { fill?: "variableName", stroke?: "variableName", fontSize?: "variableName", ... }',
    },
  },
  required: ['project', 'designId', 'nodeId', 'bindings'],
}

// ============= Token Presets =============

const TOKEN_PRESETS: Record<string, TokenSet> = {
  material: {
    colors: {
      primary: '#6750A4',
      'on-primary': '#FFFFFF',
      'primary-container': '#EADDFF',
      secondary: '#625B71',
      'on-secondary': '#FFFFFF',
      surface: '#FFFBFE',
      'on-surface': '#1C1B1F',
      'surface-variant': '#E7E0EC',
      outline: '#79747E',
      error: '#B3261E',
      'on-error': '#FFFFFF',
    },
    typography: {
      'display-large': { fontSize: 57, fontWeight: 400 },
      'display-medium': { fontSize: 45, fontWeight: 400 },
      'display-small': { fontSize: 36, fontWeight: 400 },
      'headline-large': { fontSize: 32, fontWeight: 400 },
      'headline-medium': { fontSize: 28, fontWeight: 400 },
      'headline-small': { fontSize: 24, fontWeight: 400 },
      'title-large': { fontSize: 22, fontWeight: 400 },
      'title-medium': { fontSize: 16, fontWeight: 500 },
      'title-small': { fontSize: 14, fontWeight: 500 },
      'body-large': { fontSize: 16, fontWeight: 400 },
      'body-medium': { fontSize: 14, fontWeight: 400 },
      'body-small': { fontSize: 12, fontWeight: 400 },
      'label-large': { fontSize: 14, fontWeight: 500 },
      'label-medium': { fontSize: 12, fontWeight: 500 },
      'label-small': { fontSize: 11, fontWeight: 500 },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    radii: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  },
  ios: {
    colors: {
      blue: '#007AFF',
      green: '#34C759',
      red: '#FF3B30',
      orange: '#FF9500',
      yellow: '#FFCC00',
      purple: '#AF52DE',
      pink: '#FF2D55',
      gray: '#8E8E93',
      'gray-2': '#AEAEB2',
      'gray-3': '#C7C7CC',
      'gray-4': '#D1D1D6',
      'gray-5': '#E5E5EA',
      'gray-6': '#F2F2F7',
      label: '#000000',
      'secondary-label': '#3C3C43',
      background: '#FFFFFF',
      'secondary-background': '#F2F2F7',
      separator: '#C6C6C8',
    },
    typography: {
      'large-title': { fontSize: 34, fontWeight: 700 },
      'title-1': { fontSize: 28, fontWeight: 700 },
      'title-2': { fontSize: 22, fontWeight: 700 },
      'title-3': { fontSize: 20, fontWeight: 600 },
      headline: { fontSize: 17, fontWeight: 600 },
      body: { fontSize: 17, fontWeight: 400 },
      callout: { fontSize: 16, fontWeight: 400 },
      subheadline: { fontSize: 15, fontWeight: 400 },
      footnote: { fontSize: 13, fontWeight: 400 },
      caption1: { fontSize: 12, fontWeight: 400 },
      caption2: { fontSize: 11, fontWeight: 400 },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 20, xl: 32 },
    radii: { none: 0, sm: 6, md: 10, lg: 14, xl: 20, full: 9999 },
  },
  'minimal-dark': {
    colors: {
      bg: '#0A0A0A',
      'bg-secondary': '#141414',
      'bg-tertiary': '#1E1E1E',
      surface: '#262626',
      border: '#333333',
      text: '#FAFAFA',
      'text-secondary': '#A3A3A3',
      'text-muted': '#737373',
      accent: '#FAFAFA',
      'accent-secondary': '#A3A3A3',
      error: '#EF4444',
      success: '#22C55E',
      warning: '#F59E0B',
    },
    typography: {
      h1: { fontSize: 48, fontWeight: 700 },
      h2: { fontSize: 36, fontWeight: 600 },
      h3: { fontSize: 24, fontWeight: 600 },
      h4: { fontSize: 20, fontWeight: 500 },
      body: { fontSize: 16, fontWeight: 400 },
      'body-sm': { fontSize: 14, fontWeight: 400 },
      caption: { fontSize: 12, fontWeight: 400 },
      label: { fontSize: 14, fontWeight: 500 },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
    radii: { none: 0, sm: 4, md: 8, lg: 12, full: 9999 },
  },
  'minimal-light': {
    colors: {
      bg: '#FFFFFF',
      'bg-secondary': '#F9FAFB',
      'bg-tertiary': '#F3F4F6',
      surface: '#E5E7EB',
      border: '#D1D5DB',
      text: '#111827',
      'text-secondary': '#6B7280',
      'text-muted': '#9CA3AF',
      accent: '#111827',
      'accent-secondary': '#6B7280',
      error: '#EF4444',
      success: '#22C55E',
      warning: '#F59E0B',
    },
    typography: {
      h1: { fontSize: 48, fontWeight: 700 },
      h2: { fontSize: 36, fontWeight: 600 },
      h3: { fontSize: 24, fontWeight: 600 },
      h4: { fontSize: 20, fontWeight: 500 },
      body: { fontSize: 16, fontWeight: 400 },
      'body-sm': { fontSize: 14, fontWeight: 400 },
      caption: { fontSize: 12, fontWeight: 400 },
      label: { fontSize: 14, fontWeight: 500 },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
    radii: { none: 0, sm: 4, md: 8, lg: 12, full: 9999 },
  },
}

// ============= Template Generators =============

function generateNavbar(params: Record<string, any> = {}): TreeSpec {
  const title = params.title ?? 'App Title'
  const fill = params.fill ?? '#FFFFFF'
  const textColor = params.textColor ?? '#000000'
  const width = params.width ?? 390
  const height = params.height ?? 56

  return {
    type: 'FRAME', name: 'Navbar', ref: 'navbar',
    width, height, fill,
    layoutMode: 'HORIZONTAL', padding: 16,
    primaryAxisAlign: 'SPACE_BETWEEN', counterAxisAlign: 'CENTER',
    children: [
      { type: 'TEXT', name: 'Back', text: '\u2190', fontSize: 20, fontWeight: 400, fill: textColor, width: 24, height: 24 },
      { type: 'TEXT', name: 'Title', text: title, fontSize: 17, fontWeight: 600, fill: textColor, textAlignHorizontal: 'CENTER', width: 200, height: 24 },
      { type: 'TEXT', name: 'Action', text: '\u22EF', fontSize: 20, fontWeight: 400, fill: textColor, width: 24, height: 24 },
    ],
  }
}

function generateCard(params: Record<string, any> = {}): TreeSpec {
  const title = params.title ?? 'Card Title'
  const subtitle = params.subtitle ?? 'Card description goes here'
  const fill = params.fill ?? '#FFFFFF'
  const width = params.width ?? 340
  const imageHeight = params.imageHeight ?? 180

  return {
    type: 'FRAME', name: 'Card', ref: 'card',
    width, fill, cornerRadius: 12,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG', counterAxisSizing: 'FIXED',
    clipsContent: true,
    children: [
      { type: 'RECTANGLE', name: 'Card Image', width, height: imageHeight, fill: '#E5E7EB' },
      {
        type: 'FRAME', name: 'Card Content', fill,
        layoutMode: 'VERTICAL', padding: 16, itemSpacing: 8,
        primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL',
        children: [
          { type: 'TEXT', name: 'Card Title', text: title, fontSize: 18, fontWeight: 600, fill: '#111827', width: width - 32, height: 24 },
          { type: 'TEXT', name: 'Card Subtitle', text: subtitle, fontSize: 14, fontWeight: 400, fill: '#6B7280', width: width - 32, height: 20 },
        ],
      },
    ],
  }
}

function generateButton(params: Record<string, any> = {}): TreeSpec {
  const label = params.label ?? 'Button'
  const fill = params.fill ?? '#3B82F6'
  const textColor = params.textColor ?? '#FFFFFF'
  const width = params.width ?? 120
  const height = params.height ?? 44
  const cornerRadius = params.cornerRadius ?? 8

  return {
    type: 'FRAME', name: 'Button', ref: 'button',
    width, height, fill, cornerRadius,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    children: [
      { type: 'TEXT', name: 'Button Label', text: label, fontSize: 16, fontWeight: 500, fill: textColor, width: width - 24, height: 20, textAlignHorizontal: 'CENTER' },
    ],
  }
}

function generateInput(params: Record<string, any> = {}): TreeSpec {
  const placeholder = params.placeholder ?? 'Enter text...'
  const label = params.label
  const width = params.width ?? 300
  const height = params.height ?? 44

  const children: TreeSpec[] = []
  if (label) {
    children.push({ type: 'TEXT', name: 'Input Label', text: label, fontSize: 14, fontWeight: 500, fill: '#374151', width: width, height: 20 })
  }
  children.push({
    type: 'FRAME', name: 'Input Field', ref: 'input-field',
    width, height, fill: '#FFFFFF', cornerRadius: 8,
    stroke: '#D1D5DB', strokeWeight: 1,
    layoutMode: 'HORIZONTAL', padding: 12, counterAxisAlign: 'CENTER',
    children: [
      { type: 'TEXT', name: 'Placeholder', text: placeholder, fontSize: 16, fontWeight: 400, fill: '#9CA3AF', width: width - 24, height: 20 },
    ],
  })

  return {
    type: 'FRAME', name: 'Input', ref: 'input',
    width, layoutMode: 'VERTICAL', itemSpacing: 6,
    primaryAxisSizing: 'HUG', counterAxisSizing: 'FIXED',
    children,
  }
}

function generateListItem(params: Record<string, any> = {}): TreeSpec {
  const title = params.title ?? 'List Item'
  const subtitle = params.subtitle
  const width = params.width ?? 390
  const height = params.height ?? 56

  const textChildren: TreeSpec[] = [
    { type: 'TEXT', name: 'Item Title', text: title, fontSize: 16, fontWeight: 400, fill: '#111827', width: width - 80, height: 20 },
  ]
  if (subtitle) {
    textChildren.push({ type: 'TEXT', name: 'Item Subtitle', text: subtitle, fontSize: 14, fontWeight: 400, fill: '#6B7280', width: width - 80, height: 18 })
  }

  return {
    type: 'FRAME', name: 'List Item', ref: 'list-item',
    width, height, fill: '#FFFFFF',
    layoutMode: 'HORIZONTAL', padding: 16,
    counterAxisAlign: 'CENTER', itemSpacing: 12,
    children: [
      { type: 'ELLIPSE', name: 'Avatar', width: 40, height: 40, fill: '#E5E7EB' },
      {
        type: 'FRAME', name: 'Text Content',
        layoutMode: 'VERTICAL', itemSpacing: 2,
        primaryAxisSizing: 'HUG', layoutGrow: 1,
        children: textChildren,
      },
      { type: 'TEXT', name: 'Chevron', text: '\u203A', fontSize: 20, fontWeight: 400, fill: '#9CA3AF', width: 12, height: 24 },
    ],
  }
}

function generateAvatar(params: Record<string, any> = {}): TreeSpec {
  const size = params.size ?? 48
  const fill = params.fill ?? '#6366F1'
  const initials = params.initials ?? 'AB'
  const textColor = params.textColor ?? '#FFFFFF'

  return {
    type: 'FRAME', name: 'Avatar', ref: 'avatar',
    width: size, height: size, fill, cornerRadius: size / 2,
    clipsContent: true,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    children: [
      { type: 'TEXT', name: 'Initials', text: initials, fontSize: Math.round(size * 0.4), fontWeight: 600, fill: textColor, width: size - 4, height: Math.round(size * 0.5), textAlignHorizontal: 'CENTER' },
    ],
  }
}

function generateBadge(params: Record<string, any> = {}): TreeSpec {
  const text = params.text ?? '3'
  const fill = params.fill ?? '#EF4444'
  const textColor = params.textColor ?? '#FFFFFF'
  const size = params.size ?? 24

  return {
    type: 'FRAME', name: 'Badge', ref: 'badge',
    width: size, height: size, fill, cornerRadius: size / 2,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    children: [
      { type: 'TEXT', name: 'Badge Text', text, fontSize: 12, fontWeight: 600, fill: textColor, width: size - 4, height: 14, textAlignHorizontal: 'CENTER' },
    ],
  }
}

function generateModal(params: Record<string, any> = {}): TreeSpec {
  const title = params.title ?? 'Modal Title'
  const body = params.body ?? 'Modal content goes here.'
  const width = params.width ?? 340
  const fill = params.fill ?? '#FFFFFF'

  return {
    type: 'FRAME', name: 'Modal Overlay', ref: 'modal-overlay',
    width: 390, height: 844, fill: '#00000066',
    layoutMode: 'VERTICAL',
    primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    children: [{
      type: 'FRAME', name: 'Modal', ref: 'modal',
      width, fill, cornerRadius: 16,
      layoutMode: 'VERTICAL', padding: 24, itemSpacing: 16,
      primaryAxisSizing: 'HUG', counterAxisSizing: 'FIXED',
      children: [
        { type: 'TEXT', name: 'Modal Title', text: title, fontSize: 20, fontWeight: 600, fill: '#111827', width: width - 48, height: 24 },
        { type: 'TEXT', name: 'Modal Body', text: body, fontSize: 16, fontWeight: 400, fill: '#6B7280', width: width - 48, height: 48 },
        {
          type: 'FRAME', name: 'Modal Actions',
          layoutMode: 'HORIZONTAL', itemSpacing: 12,
          primaryAxisAlign: 'MAX', primaryAxisSizing: 'FILL', counterAxisSizing: 'HUG',
          children: [
            generateButton({ label: 'Cancel', fill: '#E5E7EB', textColor: '#374151', width: 100 }),
            generateButton({ label: 'Confirm', fill: '#3B82F6', textColor: '#FFFFFF', width: 100 }),
          ],
        },
      ],
    }],
  }
}

function generateTabBar(params: Record<string, any> = {}): TreeSpec {
  const items = params.items ?? ['Home', 'Search', 'Profile']
  const fill = params.fill ?? '#FFFFFF'
  const activeColor = params.activeColor ?? '#3B82F6'
  const inactiveColor = params.inactiveColor ?? '#9CA3AF'
  const width = params.width ?? 390

  return {
    type: 'FRAME', name: 'Tab Bar', ref: 'tab-bar',
    width, height: 56, fill,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'SPACE_BETWEEN', counterAxisAlign: 'CENTER',
    paddingTop: 8, paddingBottom: 8, paddingLeft: 16, paddingRight: 16,
    children: items.map((item: string, i: number) => ({
      type: 'FRAME', name: `Tab ${item}`,
      layoutMode: 'VERTICAL', itemSpacing: 4,
      primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
      primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG',
      layoutGrow: 1,
      children: [
        { type: 'ELLIPSE', name: `${item} Icon`, width: 24, height: 24, fill: i === 0 ? activeColor : inactiveColor },
        { type: 'TEXT', name: `${item} Label`, text: item, fontSize: 10, fontWeight: 500, fill: i === 0 ? activeColor : inactiveColor, width: 60, height: 12, textAlignHorizontal: 'CENTER' },
      ],
    })),
  }
}

function generateForm(params: Record<string, any> = {}): TreeSpec {
  const title = params.title ?? 'Form'
  const fields = params.fields ?? [
    { label: 'Name', placeholder: 'Enter your name' },
    { label: 'Email', placeholder: 'Enter your email' },
  ]
  const width = params.width ?? 340
  const submitLabel = params.submitLabel ?? 'Submit'

  return {
    type: 'FRAME', name: 'Form', ref: 'form',
    width, fill: '#FFFFFF', cornerRadius: 12,
    layoutMode: 'VERTICAL', padding: 24, itemSpacing: 16,
    primaryAxisSizing: 'HUG', counterAxisSizing: 'FIXED',
    children: [
      { type: 'TEXT', name: 'Form Title', text: title, fontSize: 24, fontWeight: 600, fill: '#111827', width: width - 48, height: 32 },
      ...fields.map((field: any) => generateInput({ label: field.label, placeholder: field.placeholder, width: width - 48 })),
      generateButton({ label: submitLabel, fill: '#3B82F6', textColor: '#FFFFFF', width: width - 48, height: 44 }),
    ],
  }
}

const TEMPLATE_GENERATORS: Record<string, (params: Record<string, any>) => TreeSpec> = {
  navbar: generateNavbar,
  card: generateCard,
  button: generateButton,
  input: generateInput,
  'list-item': generateListItem,
  avatar: generateAvatar,
  badge: generateBadge,
  modal: generateModal,
  'tab-bar': generateTabBar,
  form: generateForm,
}

// ============= Handlers =============

export async function handleCreateFromTemplate(
  project: string,
  session: string,
  designId: string,
  template: string,
  params: Record<string, any> = {},
  parentId?: string
): Promise<{ success: boolean; nodeIds: Record<string, string>; rootNodeId: string }> {
  const generator = TEMPLATE_GENERATORS[template]
  if (!generator) throw new Error(`Unknown template: ${template}. Available: ${Object.keys(TEMPLATE_GENERATORS).join(', ')}`)

  const tree = generator(params)
  return handleCreateDesignFromTree(project, session, designId, tree, parentId)
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function handleCreateDesignTokens(
  project: string,
  session: string,
  designId: string,
  preset?: string,
  custom?: Partial<TokenSet>
): Promise<{ success: boolean; collectionId: string; variableIds: string[] }> {
  const tokenSet: Partial<TokenSet> = preset ? TOKEN_PRESETS[preset] : custom
  if (!tokenSet) throw new Error(`Unknown preset: ${preset}. Available: ${Object.keys(TOKEN_PRESETS).join(', ')}`)

  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content

  // Ensure graph structure
  if (!content.variableCollections) content.variableCollections = []
  if (!content.variables) content.variables = []

  const collectionId = generateId()
  const modeId = generateId()
  const collectionName = preset ? `${preset} tokens` : 'Custom Tokens'
  const variableIds: string[] = []

  // Create color variables
  if (tokenSet.colors) {
    for (const [name, hex] of Object.entries(tokenSet.colors)) {
      const varId = generateId()
      const h = hex.replace('#', '')
      const r = parseInt(h.slice(0, 2), 16) / 255
      const g = parseInt(h.slice(2, 4), 16) / 255
      const b = parseInt(h.slice(4, 6), 16) / 255
      content.variables.push({
        id: varId,
        name: `color/${name}`,
        resolvedType: 'COLOR',
        valuesByMode: { [modeId]: { r, g, b, a: 1 } },
        collectionId,
      })
      variableIds.push(varId)
    }
  }

  // Create typography variables (as number variables for fontSize)
  if (tokenSet.typography) {
    for (const [name, { fontSize, fontWeight }] of Object.entries(tokenSet.typography)) {
      const sizeId = generateId()
      content.variables.push({
        id: sizeId,
        name: `type/${name}/size`,
        resolvedType: 'FLOAT',
        valuesByMode: { [modeId]: fontSize },
        collectionId,
      })
      variableIds.push(sizeId)

      const weightId = generateId()
      content.variables.push({
        id: weightId,
        name: `type/${name}/weight`,
        resolvedType: 'FLOAT',
        valuesByMode: { [modeId]: fontWeight },
        collectionId,
      })
      variableIds.push(weightId)
    }
  }

  // Create spacing variables
  if (tokenSet.spacing) {
    for (const [name, value] of Object.entries(tokenSet.spacing)) {
      const varId = generateId()
      content.variables.push({
        id: varId,
        name: `spacing/${name}`,
        resolvedType: 'FLOAT',
        valuesByMode: { [modeId]: value },
        collectionId,
      })
      variableIds.push(varId)
    }
  }

  // Create radii variables
  if (tokenSet.radii) {
    for (const [name, value] of Object.entries(tokenSet.radii)) {
      const varId = generateId()
      content.variables.push({
        id: varId,
        name: `radii/${name}`,
        resolvedType: 'FLOAT',
        valuesByMode: { [modeId]: value },
        collectionId,
      })
      variableIds.push(varId)
    }
  }

  // Add the collection
  content.variableCollections.push({
    id: collectionId,
    name: collectionName,
    modes: [{ modeId, name: 'Default' }],
    defaultModeId: modeId,
    variableIds,
  })

  await handleUpdateDesign(project, session, designId, content)
  return { success: true, collectionId, variableIds }
}

export async function handleApplyDesignTokens(
  project: string,
  session: string,
  designId: string,
  nodeId: string,
  bindings: Record<string, string>
): Promise<{ success: boolean; appliedBindings: Record<string, string> }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content

  if (!content.nodes) throw new Error('Design has no nodes')
  const node = content.nodes.find((n: any) => n.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)

  const variables = content.variables ?? []
  if (!node.boundVariables) node.boundVariables = {}

  const appliedBindings: Record<string, string> = {}

  for (const [prop, varName] of Object.entries(bindings)) {
    const variable = variables.find((v: any) => v.name === varName)
    if (!variable) throw new Error(`Variable not found: ${varName}`)
    node.boundVariables[prop] = { id: variable.id, type: 'VARIABLE_ALIAS' }
    appliedBindings[prop] = variable.id
  }

  await handleUpdateDesign(project, session, designId, content)
  return { success: true, appliedBindings }
}
