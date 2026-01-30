/**
 * Wireframe Validator Service
 *
 * Validates wireframe JSON structure before saving to prevent invalid
 * wireframes from crashing the renderer.
 */

export interface WireframeValidationResult {
  valid: boolean;
  error?: string;
  path?: string; // JSON path to invalid field, e.g. "screens[0].children[2]"
}

// Known component types that the renderer supports
const KNOWN_COMPONENT_TYPES = new Set([
  'screen',
  'col',
  'row',
  'card',
  'button',
  'input',
  'text',
  'title',
  'appbar',
  'bottomnav',
  'navmenu',
  'avatar',
  'image',
  'icon',
  'list',
  'divider',
]);

// Container types that require children array
const CONTAINER_TYPES = new Set(['screen', 'col', 'row', 'card']);

// Types that require an items array
const ITEMS_TYPES = new Set(['list', 'navmenu', 'bottomnav']);

/**
 * Validate bounds object
 */
function validateBounds(bounds: any, path: string): WireframeValidationResult | null {
  if (!bounds || typeof bounds !== 'object') {
    return {
      valid: false,
      error: "Missing required field 'bounds'",
      path,
    };
  }

  if (typeof bounds.x !== 'number') {
    return {
      valid: false,
      error: "bounds.x must be a number",
      path: `${path}.bounds.x`,
    };
  }

  if (typeof bounds.y !== 'number') {
    return {
      valid: false,
      error: "bounds.y must be a number",
      path: `${path}.bounds.y`,
    };
  }

  if (typeof bounds.width !== 'number') {
    return {
      valid: false,
      error: "bounds.width must be a number",
      path: `${path}.bounds.width`,
    };
  }

  if (typeof bounds.height !== 'number') {
    return {
      valid: false,
      error: "bounds.height must be a number",
      path: `${path}.bounds.height`,
    };
  }

  return null;
}

/**
 * Validate a single component recursively
 */
function validateComponent(component: any, path: string): WireframeValidationResult | null {
  // id is required
  if (!component.id || typeof component.id !== 'string' || component.id.trim() === '') {
    return {
      valid: false,
      error: "Missing or invalid required field 'id'",
      path,
    };
  }

  // type is required
  if (!component.type || typeof component.type !== 'string') {
    return {
      valid: false,
      error: "Missing required field 'type'",
      path,
    };
  }

  // Check for known component type
  if (!KNOWN_COMPONENT_TYPES.has(component.type)) {
    return {
      valid: false,
      error: `Unknown component type '${component.type}'`,
      path,
    };
  }

  // bounds is required
  const boundsError = validateBounds(component.bounds, path);
  if (boundsError) {
    return boundsError;
  }

  // Screen-specific validation
  if (component.type === 'screen') {
    if (!component.name || typeof component.name !== 'string' || component.name.trim() === '') {
      return {
        valid: false,
        error: "Missing required field 'name' for screen component",
        path,
      };
    }
  }

  // Button-specific validation
  if (component.type === 'button') {
    if (!component.label || typeof component.label !== 'string') {
      return {
        valid: false,
        error: "Missing required field 'label' for button component",
        path,
      };
    }
  }

  // Text/title-specific validation
  if (component.type === 'text' || component.type === 'title') {
    if (typeof component.content !== 'string') {
      return {
        valid: false,
        error: `Missing required field 'content' for ${component.type} component`,
        path,
      };
    }
  }

  // Container types require children array
  if (CONTAINER_TYPES.has(component.type)) {
    if (!Array.isArray(component.children)) {
      return {
        valid: false,
        error: `Missing required field 'children' for ${component.type} component`,
        path,
      };
    }

    // Recursively validate children
    for (let i = 0; i < component.children.length; i++) {
      const childError = validateComponent(component.children[i], `${path}.children[${i}]`);
      if (childError) {
        return childError;
      }
    }
  }

  // Items types require items array
  if (ITEMS_TYPES.has(component.type)) {
    if (!Array.isArray(component.items)) {
      return {
        valid: false,
        error: `Missing required field 'items' for ${component.type} component`,
        path,
      };
    }
  }

  return null;
}

/**
 * Validate wireframe root structure
 */
function validateRoot(wireframe: any): WireframeValidationResult | null {
  // viewport is required
  if (!wireframe.viewport) {
    return {
      valid: false,
      error: "Missing required field 'viewport'",
      path: 'viewport',
    };
  }

  const validViewports = ['mobile', 'tablet', 'desktop'];
  if (!validViewports.includes(wireframe.viewport)) {
    return {
      valid: false,
      error: `Invalid viewport: must be 'mobile', 'tablet', or 'desktop'`,
      path: 'viewport',
    };
  }

  // direction is required
  if (!wireframe.direction) {
    return {
      valid: false,
      error: "Missing required field 'direction'",
      path: 'direction',
    };
  }

  const validDirections = ['LR', 'TD'];
  if (!validDirections.includes(wireframe.direction)) {
    return {
      valid: false,
      error: `Invalid direction: must be 'LR' or 'TD'`,
      path: 'direction',
    };
  }

  // screens is required and must be an array
  if (!Array.isArray(wireframe.screens)) {
    return {
      valid: false,
      error: "screens must be an array",
      path: 'screens',
    };
  }

  // Validate each screen
  for (let i = 0; i < wireframe.screens.length; i++) {
    const screenError = validateComponent(wireframe.screens[i], `screens[${i}]`);
    if (screenError) {
      return screenError;
    }
  }

  return null;
}

export class WireframeValidator {
  /**
   * Validate wireframe content
   *
   * @param content - Wireframe JSON (as string or object)
   * @returns Validation result with error details if invalid
   */
  validate(content: string | object): WireframeValidationResult {
    // Parse if string
    let wireframe: any;
    if (typeof content === 'string') {
      try {
        wireframe = JSON.parse(content);
      } catch (error: any) {
        return {
          valid: false,
          error: `Invalid JSON: ${error.message}`,
        };
      }
    } else {
      wireframe = content;
    }

    // Check for empty/null content
    if (!wireframe || typeof wireframe !== 'object') {
      return {
        valid: false,
        error: 'Wireframe content must be a non-null object',
      };
    }

    // Validate root structure
    const rootError = validateRoot(wireframe);
    if (rootError) {
      return rootError;
    }

    return { valid: true };
  }
}
