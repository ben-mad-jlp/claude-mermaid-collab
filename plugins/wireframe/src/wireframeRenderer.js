/**
 * Renderer module for wireframe diagrams
 * Outputs SVG using d3
 */

import * as d3 from 'd3';

const viewportWidths = {
  mobile: 375,
  tablet: 768,
  desktop: 1200,
  default: 800
};

/**
 * Draw wireframe diagram to SVG
 * @param {string} text - Diagram text (unused)
 * @param {string} id - Container element ID
 * @param {*} _version - Version (unused)
 * @param {Object} diagObj - Diagram object with db
 */
export const draw = (text, id, _version, diagObj) => {
  const db = diagObj.db;
  const { viewport, direction, tree } = db.getData();

  const container = d3.select(`#${id}`);
  container.selectAll('*').remove();

  // Get viewport dimensions
  const viewportWidth = viewportWidths[viewport];
  const viewportHeight = 600;
  const screenGap = 32; // Gap between screens
  const screenPadding = 16; // Padding for screen labels

  // Count screen nodes
  const screens = tree.filter(node => node.type === 'screen');
  const hasScreens = screens.length > 0;
  const screenCount = hasScreens ? screens.length : 1;

  // Calculate canvas size based on direction
  let canvasWidth, canvasHeight;
  if (!hasScreens) {
    // No screens - use raw viewport dimensions
    canvasWidth = viewportWidth;
    canvasHeight = viewportHeight;
  } else if (direction === 'TD') {
    canvasWidth = viewportWidth + (screenPadding * 2);
    canvasHeight = (viewportHeight + screenPadding * 2 + 32) * screenCount + screenGap * (screenCount - 1);
  } else {
    canvasWidth = (viewportWidth + screenPadding * 2) * screenCount + screenGap * (screenCount - 1);
    canvasHeight = viewportHeight + screenPadding * 2 + 32;
  }

  const svg = container.append('svg');
  svg.attr('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`);

  const g = svg.append('g');

  if (hasScreens) {
    // Render each screen with label and border
    screens.forEach((screen, index) => {
      let screenX, screenY;
      if (direction === 'TD') {
        screenX = screenPadding;
        screenY = index * (viewportHeight + screenPadding * 2 + 32 + screenGap) + screenPadding + 32;
      } else {
        screenX = index * (viewportWidth + screenPadding * 2 + screenGap) + screenPadding;
        screenY = screenPadding + 32;
      }

      // Draw screen border
      g.append('rect')
        .attr('x', screenX - screenPadding)
        .attr('y', screenY - screenPadding - 32)
        .attr('width', viewportWidth + screenPadding * 2)
        .attr('height', viewportHeight + screenPadding * 2 + 32)
        .attr('fill', 'none')
        .attr('stroke', '#999')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8 4')
        .attr('rx', 8);

      // Draw screen label if present
      if (screen.label) {
        g.append('text')
          .attr('x', screenX - screenPadding + 8)
          .attr('y', screenY - screenPadding - 8)
          .attr('font-size', 14)
          .attr('font-weight', 'bold')
          .attr('fill', '#666')
          .text(screen.label);
      }

      // Render screen content
      const screenBounds = { x: screenX, y: screenY, width: viewportWidth, height: viewportHeight };
      renderNode(g, screen, screenBounds);
    });
  } else {
    // No screens defined, render all root nodes as single screen
    const rootBounds = { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
    if (tree.length > 0) {
      renderNode(g, tree[0], rootBounds);
    }
  }
};

/**
 * Render a single node and its children
 * @param {Object} svg - d3 selection
 * @param {Object} node - Node to render
 * @param {Object} bounds - Bounding box {x, y, width, height}
 */
function renderNode(svg, node, bounds) {
  // Apply padding to bounds
  const contentBounds = applyPadding(bounds, node.modifiers.padding);

  // Draw the widget/container
  drawWidget(svg, node, contentBounds);

  // Render children
  if (node.children && node.children.length > 0) {
    const direction = node.type === 'row' ? 'horizontal' : 'vertical';
    renderChildren(svg, node.children, contentBounds, direction);
  }
}

/**
 * Apply padding to bounds
 * @param {Object} bounds - Original bounds
 * @param {number} padding - Padding value
 * @returns {Object} New bounds with padding applied
 */
function applyPadding(bounds, padding = 0) {
  return {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: bounds.width - padding * 2,
    height: bounds.height - padding * 2
  };
}

/**
 * Draw widget based on type
 * @param {Object} svg - d3 selection
 * @param {Object} node - Node to draw
 * @param {Object} bounds - Bounding box
 */
function drawWidget(svg, node, bounds) {
  const { type, label, modifiers } = node;

  switch (type) {
    case 'row':
    case 'col':
      drawContainer(svg, bounds);
      break;
    case 'screen':
      // Screen border is drawn in main draw function
      // Screen acts as a vertical container for its children
      break;
    case 'Text':
      drawText(svg, label, bounds, 'normal');
      break;
    case 'Title':
      drawText(svg, label, bounds, 'title');
      break;
    case 'Button':
      drawButton(svg, label, bounds, modifiers);
      break;
    case 'Input':
      drawInput(svg, label, bounds);
      break;
    case 'Checkbox':
      drawCheckbox(svg, label, bounds);
      break;
    case 'Radio':
      drawRadio(svg, label, bounds);
      break;
    case 'Switch':
      drawSwitch(svg, label, bounds);
      break;
    case 'Dropdown':
      drawDropdown(svg, label, bounds);
      break;
    case 'List':
      drawList(svg, label, bounds);
      break;
    case 'NavMenu':
      drawNavMenu(svg, label, bounds, false);
      break;
    case 'BottomNav':
      drawNavMenu(svg, label, bounds, true);
      break;
    case 'AppBar':
      drawAppBar(svg, label, bounds);
      break;
    case 'FAB':
      drawFAB(svg, label, bounds);
      break;
    case 'Avatar':
      drawAvatar(svg, bounds);
      break;
    case 'Icon':
      drawIcon(svg, label, bounds);
      break;
    case 'Image':
      drawImage(svg, bounds);
      break;
    case 'Card':
      drawCard(svg, bounds);
      break;
    case 'Grid':
      drawGrid(svg, node, bounds);
      break;
    case 'divider':
      drawDivider(svg, bounds);
      break;
    case 'spacer':
      // Spacer renders nothing
      break;
  }
}

/**
 * Draw container (row/col) with dashed border
 */
function drawContainer(svg, bounds) {
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('fill', 'none')
    .attr('stroke', '#ccc')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 2');
}

/**
 * Draw text (normal or title)
 */
function drawText(svg, label, bounds, style) {
  const fontSize = style === 'title' ? 18 : 14;
  const fontWeight = style === 'title' ? 'bold' : 'normal';

  svg.append('text')
    .attr('x', bounds.x + bounds.width / 2)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', fontSize)
    .attr('font-weight', fontWeight)
    .attr('fill', '#000')
    .text(label || '');
}

/**
 * Draw button with variants
 */
function drawButton(svg, label, bounds, modifiers) {
  const variant = modifiers.variant || 'default';
  let fill = '#eee';
  let textColor = '#000';

  if (variant === 'primary') {
    fill = '#000';
    textColor = '#fff';
  } else if (variant === 'secondary') {
    fill = '#fff';
    textColor = '#000';
  } else if (variant === 'danger') {
    fill = '#d00';
    textColor = '#fff';
  } else if (variant === 'success') {
    fill = '#0a0';
    textColor = '#fff';
  } else if (variant === 'disabled') {
    fill = '#f5f5f5';
    textColor = '#999';
  }

  // Button background
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('rx', 4)
    .attr('fill', fill)
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Button text
  svg.append('text')
    .attr('x', bounds.x + bounds.width / 2)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('font-weight', 'bold')
    .attr('fill', textColor)
    .text(label || 'Button');
}

/**
 * Draw input field
 */
function drawInput(svg, label, bounds) {
  // Input background
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('rx', 2)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Placeholder text
  svg.append('text')
    .attr('x', bounds.x + 8)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#999')
    .text(label || 'Enter text...');
}

/**
 * Draw checkbox
 */
function drawCheckbox(svg, label, bounds) {
  const boxSize = 16;
  const boxX = bounds.x + 4;
  const boxY = bounds.y + bounds.height / 2 - boxSize / 2;

  // Checkbox box
  svg.append('rect')
    .attr('x', boxX)
    .attr('y', boxY)
    .attr('width', boxSize)
    .attr('height', boxSize)
    .attr('rx', 2)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Checkmark
  svg.append('path')
    .attr('d', `M ${boxX + 3} ${boxY + 8} L ${boxX + 6} ${boxY + 11} L ${boxX + 13} ${boxY + 4}`)
    .attr('stroke', '#666')
    .attr('stroke-width', 2)
    .attr('fill', 'none');

  // Label
  svg.append('text')
    .attr('x', boxX + boxSize + 8)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#000')
    .text(label || 'Checkbox');
}

/**
 * Draw radio button
 */
function drawRadio(svg, label, bounds) {
  const radius = 8;
  const centerX = bounds.x + radius + 4;
  const centerY = bounds.y + bounds.height / 2;

  // Radio outer circle
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('r', radius)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Radio inner dot
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('r', 4)
    .attr('fill', '#666');

  // Label
  svg.append('text')
    .attr('x', centerX + radius + 8)
    .attr('y', centerY)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#000')
    .text(label || 'Radio');
}

/**
 * Draw switch
 */
function drawSwitch(svg, label, bounds) {
  const switchWidth = 36;
  const switchHeight = 20;
  const switchX = bounds.x + 4;
  const switchY = bounds.y + bounds.height / 2 - switchHeight / 2;

  // Switch track
  svg.append('rect')
    .attr('x', switchX)
    .attr('y', switchY)
    .attr('width', switchWidth)
    .attr('height', switchHeight)
    .attr('rx', switchHeight / 2)
    .attr('fill', '#ccc')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Switch thumb (on position)
  svg.append('circle')
    .attr('cx', switchX + switchWidth - switchHeight / 2)
    .attr('cy', switchY + switchHeight / 2)
    .attr('r', switchHeight / 2 - 2)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Label
  svg.append('text')
    .attr('x', switchX + switchWidth + 8)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#000')
    .text(label || 'Switch');
}

/**
 * Draw dropdown
 */
function drawDropdown(svg, label, bounds) {
  // Dropdown background
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('rx', 2)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Label
  svg.append('text')
    .attr('x', bounds.x + 8)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#000')
    .text(label || 'Select...');

  // Dropdown arrow
  const arrowX = bounds.x + bounds.width - 20;
  const arrowY = bounds.y + bounds.height / 2;
  svg.append('path')
    .attr('d', `M ${arrowX} ${arrowY - 3} L ${arrowX + 5} ${arrowY + 3} L ${arrowX + 10} ${arrowY - 3}`)
    .attr('stroke', '#666')
    .attr('stroke-width', 2)
    .attr('fill', 'none');
}

/**
 * Draw list
 */
function drawList(svg, label, bounds) {
  const items = label ? label.split('|') : ['Item 1', 'Item 2', 'Item 3'];
  const itemHeight = bounds.height / items.length;

  items.forEach((item, i) => {
    const itemY = bounds.y + i * itemHeight;

    // List item background
    svg.append('rect')
      .attr('x', bounds.x)
      .attr('y', itemY)
      .attr('width', bounds.width)
      .attr('height', itemHeight)
      .attr('fill', i % 2 === 0 ? '#fff' : '#f9f9f9')
      .attr('stroke', '#eee')
      .attr('stroke-width', 1);

    // Item text
    svg.append('text')
      .attr('x', bounds.x + 8)
      .attr('y', itemY + itemHeight / 2)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 14)
      .attr('fill', '#000')
      .text(item.trim());
  });
}

/**
 * Draw nav menu (horizontal)
 */
function drawNavMenu(svg, label, bounds, isBottom) {
  // Background
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('fill', '#f5f5f5')
    .attr('stroke', '#ccc')
    .attr('stroke-width', 1);

  const items = label ? label.split('|') : ['Home', 'About', 'Contact'];
  const itemWidth = bounds.width / items.length;

  items.forEach((item, i) => {
    const itemX = bounds.x + i * itemWidth;

    // Item text
    svg.append('text')
      .attr('x', itemX + itemWidth / 2)
      .attr('y', bounds.y + bounds.height / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 14)
      .attr('fill', '#000')
      .text(item.trim());

    // Divider (except last item)
    if (i < items.length - 1) {
      svg.append('line')
        .attr('x1', itemX + itemWidth)
        .attr('y1', bounds.y + 8)
        .attr('x2', itemX + itemWidth)
        .attr('y2', bounds.y + bounds.height - 8)
        .attr('stroke', '#ccc')
        .attr('stroke-width', 1);
    }
  });
}

/**
 * Draw app bar
 */
function drawAppBar(svg, label, bounds) {
  // AppBar background
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('fill', '#666')
    .attr('stroke', '#000')
    .attr('stroke-width', 1);

  // Title
  svg.append('text')
    .attr('x', bounds.x + bounds.width / 2)
    .attr('y', bounds.y + bounds.height / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 18)
    .attr('font-weight', 'bold')
    .attr('fill', '#fff')
    .text(label || 'App Title');
}

/**
 * Draw FAB (floating action button)
 */
function drawFAB(svg, label, bounds) {
  const radius = Math.min(bounds.width, bounds.height) / 2;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  // FAB circle
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('r', radius)
    .attr('fill', '#000')
    .attr('stroke', '#666')
    .attr('stroke-width', 2);

  // Plus icon
  const iconSize = 16;
  svg.append('line')
    .attr('x1', centerX - iconSize / 2)
    .attr('y1', centerY)
    .attr('x2', centerX + iconSize / 2)
    .attr('y2', centerY)
    .attr('stroke', '#fff')
    .attr('stroke-width', 3);

  svg.append('line')
    .attr('x1', centerX)
    .attr('y1', centerY - iconSize / 2)
    .attr('x2', centerX)
    .attr('y2', centerY + iconSize / 2)
    .attr('stroke', '#fff')
    .attr('stroke-width', 3);
}

/**
 * Draw avatar
 */
function drawAvatar(svg, bounds) {
  const radius = Math.min(bounds.width, bounds.height) / 2;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  // Avatar circle
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('r', radius)
    .attr('fill', '#ccc')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Simple person icon (head)
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY - radius / 4)
    .attr('r', radius / 3)
    .attr('fill', '#fff');

  // Simple person icon (body)
  svg.append('ellipse')
    .attr('cx', centerX)
    .attr('cy', centerY + radius / 2)
    .attr('rx', radius * 0.6)
    .attr('ry', radius * 0.5)
    .attr('fill', '#fff');
}

/**
 * Draw icon
 */
function drawIcon(svg, label, bounds) {
  const size = Math.min(bounds.width, bounds.height);
  const x = bounds.x + (bounds.width - size) / 2;
  const y = bounds.y + (bounds.height - size) / 2;

  // Icon box
  svg.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', size)
    .attr('height', size)
    .attr('fill', 'none')
    .attr('stroke', '#666')
    .attr('stroke-width', 1);

  // Icon text
  svg.append('text')
    .attr('x', x + size / 2)
    .attr('y', y + size / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', 10)
    .attr('fill', '#666')
    .text(`[${label || 'icon'}]`);
}

/**
 * Draw image placeholder
 */
function drawImage(svg, bounds) {
  // Image border
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('fill', '#eee')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // X through image
  svg.append('line')
    .attr('x1', bounds.x)
    .attr('y1', bounds.y)
    .attr('x2', bounds.x + bounds.width)
    .attr('y2', bounds.y + bounds.height)
    .attr('stroke', '#ccc')
    .attr('stroke-width', 2);

  svg.append('line')
    .attr('x1', bounds.x + bounds.width)
    .attr('y1', bounds.y)
    .attr('x2', bounds.x)
    .attr('y2', bounds.y + bounds.height)
    .attr('stroke', '#ccc')
    .attr('stroke-width', 2);
}

/**
 * Draw card
 */
function drawCard(svg, bounds) {
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('rx', 8)
    .attr('fill', '#fff')
    .attr('stroke', '#ccc')
    .attr('stroke-width', 1);
}

/**
 * Draw grid (table)
 */
function drawGrid(svg, node, bounds) {
  // Grid border
  svg.append('rect')
    .attr('x', bounds.x)
    .attr('y', bounds.y)
    .attr('width', bounds.width)
    .attr('height', bounds.height)
    .attr('fill', '#fff')
    .attr('stroke', '#999')
    .attr('stroke-width', 1);

  // Find header and row children
  const headerChild = node.children?.find(c => c.type === 'grid-header');
  const rowChildren = node.children?.filter(c => c.type === 'grid-row') || [];

  const numRows = rowChildren.length + (headerChild ? 1 : 0);
  if (numRows === 0) return;

  const rowHeight = bounds.height / numRows;
  let currentY = bounds.y;

  // Draw header if present
  if (headerChild) {
    svg.append('rect')
      .attr('x', bounds.x)
      .attr('y', currentY)
      .attr('width', bounds.width)
      .attr('height', rowHeight)
      .attr('fill', '#f5f5f5')
      .attr('stroke', '#999')
      .attr('stroke-width', 1);

    const cols = headerChild.label ? headerChild.label.split('|') : [];
    const colWidth = bounds.width / cols.length;

    cols.forEach((col, i) => {
      svg.append('text')
        .attr('x', bounds.x + i * colWidth + colWidth / 2)
        .attr('y', currentY + rowHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .attr('fill', '#000')
        .text(col.trim());
    });

    currentY += rowHeight;
  }

  // Draw rows
  rowChildren.forEach((rowChild, rowIndex) => {
    const cols = rowChild.label ? rowChild.label.split('|') : [];
    const colWidth = bounds.width / cols.length;

    cols.forEach((col, i) => {
      // Cell background
      svg.append('rect')
        .attr('x', bounds.x + i * colWidth)
        .attr('y', currentY)
        .attr('width', colWidth)
        .attr('height', rowHeight)
        .attr('fill', rowIndex % 2 === 0 ? '#fff' : '#f9f9f9')
        .attr('stroke', '#eee')
        .attr('stroke-width', 1);

      // Cell text
      svg.append('text')
        .attr('x', bounds.x + i * colWidth + colWidth / 2)
        .attr('y', currentY + rowHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 12)
        .attr('fill', '#000')
        .text(col.trim());
    });

    currentY += rowHeight;
  });
}

/**
 * Draw divider
 */
function drawDivider(svg, bounds) {
  svg.append('line')
    .attr('x1', bounds.x)
    .attr('y1', bounds.y + bounds.height / 2)
    .attr('x2', bounds.x + bounds.width)
    .attr('y2', bounds.y + bounds.height / 2)
    .attr('stroke', '#ccc')
    .attr('stroke-width', 1);
}

/**
 * Render children with flex layout
 * @param {Object} svg - d3 selection
 * @param {Array} children - Child nodes
 * @param {Object} bounds - Parent bounds
 * @param {string} direction - 'horizontal' or 'vertical'
 */
function renderChildren(svg, children, bounds, direction) {
  const isRow = direction === 'horizontal';
  const crossAxis = isRow ? 'height' : 'width';

  const sizes = calculateFlexSizes(children, bounds, direction);

  let position = isRow ? bounds.x : bounds.y;

  children.forEach((child, i) => {
    const childBounds = isRow
      ? { x: position, y: bounds.y, width: sizes[i], height: bounds[crossAxis] }
      : { x: bounds.x, y: position, width: bounds[crossAxis], height: sizes[i] };

    renderNode(svg, child, childBounds);
    position += sizes[i];
  });
}

/**
 * Get intrinsic size for widget
 * @param {Object} node - Widget node
 * @param {string} axis - 'width' or 'height'
 * @returns {number} Intrinsic size in pixels
 */
function getIntrinsicSize(node, axis) {
  const { type, label = '', children = [], modifiers = {} } = node;

  // If container has children, calculate their total size
  if (children.length > 0 && (type === 'col' || type === 'row' || type === 'Card' || type === 'screen')) {
    const isVerticalContainer = type === 'col' || type === 'Card' || type === 'screen';
    const padding = modifiers.padding || 0;

    // For vertical containers calculating height, or horizontal containers calculating width
    if ((isVerticalContainer && axis === 'height') || (!isVerticalContainer && axis === 'width')) {
      // Sum all children sizes
      let totalSize = 0;
      children.forEach(child => {
        if (child.modifiers && child.modifiers[axis]) {
          totalSize += child.modifiers[axis];
        } else {
          totalSize += getIntrinsicSize(child, axis);
        }
      });
      return totalSize + (padding * 2);
    } else {
      // Cross axis - use the largest child size
      let maxSize = 0;
      children.forEach(child => {
        const childSize = child.modifiers && child.modifiers[axis]
          ? child.modifiers[axis]
          : getIntrinsicSize(child, axis);
        maxSize = Math.max(maxSize, childSize);
      });
      return maxSize + (padding * 2);
    }
  }

  if (axis === 'height') {
    // Height defaults
    if (type === 'AppBar' || type === 'BottomNav') return 56;
    if (type === 'Button' || type === 'Input') return 40;
    if (type === 'Text') return 20;
    if (type === 'Title') return 32;
    if (type === 'divider') return 1;
    if (type === 'List') return 40;
    if (type === 'Checkbox' || type === 'Radio' || type === 'Switch') return 32;
    if (type === 'Card') return 100; // fallback for Card without children
    return 40; // default
  } else {
    // Width defaults
    if (type === 'Text') return label.length * 8 + 16;
    if (type === 'Title') return label.length * 12 + 16;
    if (type === 'Button') return label.length * 8 + 32;
    if (type === 'List') return label.length * 8 + 32;
    if (type === 'Avatar') return 40;
    if (type === 'Icon') return 24;
    if (type === 'FAB') return 56;
    return 100; // default
  }
}

/**
 * Calculate sizes for flex layout
 * @param {Array} children - Child nodes
 * @param {Object} bounds - Parent bounds
 * @param {string} direction - 'horizontal' or 'vertical'
 * @returns {Array} Array of size values for each child
 */
function calculateFlexSizes(children, bounds, direction) {
  const isRow = direction === 'horizontal';
  const mainAxis = isRow ? 'width' : 'height';

  let fixedSize = 0;
  let totalFlex = 0;

  children.forEach(child => {
    if (child.modifiers[mainAxis]) {
      fixedSize += child.modifiers[mainAxis];
    } else if (child.modifiers.flex) {
      totalFlex += (child.modifiers.flex === true ? 1 : child.modifiers.flex);
    } else if (child.type === 'spacer') {
      totalFlex += 1;
    } else {
      fixedSize += getIntrinsicSize(child, mainAxis);
    }
  });

  const flexibleSpace = Math.max(0, bounds[mainAxis] - fixedSize);
  const flexUnit = totalFlex > 0 ? flexibleSpace / totalFlex : 0;

  return children.map(child => {
    if (child.modifiers[mainAxis]) {
      return child.modifiers[mainAxis];
    } else if (child.modifiers.flex) {
      const flexFactor = child.modifiers.flex === true ? 1 : child.modifiers.flex;
      return flexUnit * flexFactor;
    } else if (child.type === 'spacer') {
      return flexUnit;
    } else {
      return getIntrinsicSize(child, mainAxis);
    }
  });
}

// Export for testing
export const calculateChildBounds = (children, bounds, direction) => {
  const isRow = direction === 'horizontal';
  const sizes = calculateFlexSizes(children, bounds, direction);

  return sizes.map(size => isRow
    ? { width: size, height: bounds.height }
    : { width: bounds.width, height: size }
  );
};

export default { draw };
