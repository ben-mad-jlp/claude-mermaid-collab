// Set up DOM environment BEFORE importing mermaid
import './dom-setup.ts';
import mermaid from 'mermaid';

export type Theme = 'default' | 'dark' | 'forest' | 'neutral';
export type Format = 'svg' | 'png';

/**
 * Fix node dimensions in flowcharts rendered by JSDOM.
 * JSDOM can't calculate text bounds, so nodes get tiny 15x15 boxes.
 * This function:
 * 1. Finds each node group with its rect and foreignObject
 * 2. Calculates proper dimensions based on text length
 * 3. Resizes both the rect and foreignObject
 */
function fixNodeDimensions(svg: string): string {
  // Match node groups: <g class="node..."><rect...><g class="label">...<foreignObject>...<span>TEXT</span>
  const nodeRegex = /(<g class="node[^"]*"[^>]*>[\s\S]*?<rect[^>]*class="[^"]*label-container[^"]*"[^>]*)(x="-[\d.]+"\s*y="-[\d.]+"\s*width="[\d.]+"\s*height="[\d.]+")([\s\S]*?<foreignObject[^>]*)(width="0"\s*height="0")(>[\s\S]*?<span[^>]*>)([^<]*)([\s\S]*?<\/g><\/g>)/g;

  return svg.replace(nodeRegex, (match, before, oldDims, middle, oldFoDims, foAfter, text, after) => {
    if (!text) return match;

    // Calculate dimensions based on text (10px per char + padding)
    const width = Math.max(text.length * 10 + 24, 60);
    const height = 36;
    const halfW = width / 2;
    const halfH = height / 2;

    const newRectDims = `x="-${halfW}" y="-${halfH}" width="${width}" height="${height}"`;
    const newFoDims = `width="${width}" height="${height}" x="-${halfW}" y="-${halfH}"`;

    return before + newRectDims + middle + newFoDims + foAfter + text + after;
  });
}

/**
 * Fix edge labels that have width="0" height="0"
 */
function fixEdgeLabels(svg: string): string {
  // Match edge label foreignObjects
  const edgeLabelRegex = /<foreignObject width="0" height="0">(<div[^>]*>[\s\S]*?<span class="edgeLabel">)([^<]+)(<\/span>[\s\S]*?<\/div>)<\/foreignObject>/g;

  return svg.replace(edgeLabelRegex, (match, before, text, after) => {
    if (!text) return match;

    const width = Math.max(text.length * 8 + 12, 40);
    const height = 20;

    return `<foreignObject width="${width}" height="${height}" x="-${width/2}" y="-${height/2}">${before}${text}${after}</foreignObject>`;
  });
}

/**
 * Fix the viewBox of an SVG by parsing transform attributes and element positions.
 * JSDOM's getBBox polyfill returns fixed sizes, so we need to recalculate.
 */
function fixViewBox(svg: string): string {
  // Extract all transform="translate(x, y)" values and element positions
  const translateRegex = /transform="translate\(([\d.]+),?\s*([\d.]+)?\)"/g;
  const rectRegex = /<rect[^>]*\sx="([\d.]+)"[^>]*\sy="([\d.]+)"[^>]*(?:width="([\d.]+)")?[^>]*(?:height="([\d.]+)")?/g;
  const circleRegex = /<circle[^>]*\scx="([\d.]+)"[^>]*\scy="([\d.]+)"[^>]*(?:r="([\d.]+)")?/g;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let match;

  // Check translate transforms
  while ((match = translateRegex.exec(svg)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2] || '0');
    // Assume node size of ~150x50 for text nodes
    minX = Math.min(minX, x - 75);
    minY = Math.min(minY, y - 25);
    maxX = Math.max(maxX, x + 75);
    maxY = Math.max(maxY, y + 25);
  }

  // Check rect elements
  while ((match = rectRegex.exec(svg)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const w = parseFloat(match[3] || '100');
    const h = parseFloat(match[4] || '50');
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  // Check circle elements
  while ((match = circleRegex.exec(svg)) !== null) {
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);
    const r = parseFloat(match[3] || '20');
    minX = Math.min(minX, cx - r);
    minY = Math.min(minY, cy - r);
    maxX = Math.max(maxX, cx + r);
    maxY = Math.max(maxY, cy + r);
  }

  // If we found valid bounds, update the viewBox
  if (minX !== Infinity && maxX !== -Infinity) {
    const padding = 20;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const viewBox = `${minX - padding} ${minY - padding} ${width} ${height}`;

    // Replace viewBox and max-width in SVG
    svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
    svg = svg.replace(/style="max-width: \d+px;"/, `style="max-width: ${width}px;"`);
  }

  return svg;
}

export class Renderer {
  private thumbnailCache: Map<string, Buffer> = new Map();

  async renderSVG(content: string, theme: Theme = 'default'): Promise<string> {
    mermaid.initialize({
      theme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('diagram', content);

    // Fix JSDOM rendering issues:
    // 1. Fix node dimensions (rects + foreignObjects)
    // 2. Fix edge labels
    // 3. Fix viewBox since JSDOM's getBBox is a stub
    let fixed = fixNodeDimensions(svg);
    fixed = fixEdgeLabels(fixed);
    fixed = fixViewBox(fixed);
    return fixed;
  }

  async generateThumbnail(id: string, content: string): Promise<Buffer> {
    // Check cache first
    const cached = this.thumbnailCache.get(id);
    if (cached) return cached;

    // Generate SVG
    const svg = await this.renderSVG(content, 'default');

    // For now, return SVG as buffer (PNG conversion would need puppeteer/sharp)
    // This is a simplified version - production would convert to PNG
    const buffer = Buffer.from(svg, 'utf-8');

    // Cache it (implement LRU if cache grows too large)
    if (this.thumbnailCache.size >= 100) {
      const firstKey = this.thumbnailCache.keys().next().value;
      this.thumbnailCache.delete(firstKey);
    }

    this.thumbnailCache.set(id, buffer);

    return buffer;
  }

  clearCache(): void {
    this.thumbnailCache.clear();
  }
}
