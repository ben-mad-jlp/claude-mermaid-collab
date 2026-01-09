// Set up DOM environment BEFORE importing mermaid
import './dom-setup.ts';
import mermaid from 'mermaid';

export type Theme = 'default' | 'dark' | 'forest' | 'neutral';
export type Format = 'svg' | 'png';

export class Renderer {
  private thumbnailCache: Map<string, Buffer> = new Map();

  async renderSVG(content: string, theme: Theme = 'default'): Promise<string> {
    mermaid.initialize({
      theme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('diagram', content);
    return svg;
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
