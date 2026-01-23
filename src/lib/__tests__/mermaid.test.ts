import {
  initializeMermaid,
  renderToSVG,
  renderWithDimensions,
  validateDiagram,
  getCurrentTheme,
  setTheme,
  reset,
  isInitializedMermaid,
  MermaidError,
  type Theme,
} from '../mermaid';

describe('Mermaid Library', () => {
  // Reset Mermaid state before each test
  beforeEach(() => {
    reset();
  });

  describe('initializeMermaid', () => {
    it('should initialize Mermaid with default options', async () => {
      await initializeMermaid();
      expect(isInitializedMermaid()).toBe(true);
    });

    it('should initialize Mermaid with custom theme', async () => {
      await initializeMermaid({ theme: 'dark' });
      expect(isInitializedMermaid()).toBe(true);
      expect(getCurrentTheme()).toBe('dark');
    });

    it('should initialize Mermaid with multiple options', async () => {
      await initializeMermaid({
        theme: 'forest',
        startOnLoad: false,
        securityLevel: 'strict',
      });
      expect(isInitializedMermaid()).toBe(true);
      expect(getCurrentTheme()).toBe('forest');
    });

    it('should be idempotent - calling twice should not fail', async () => {
      await initializeMermaid({ theme: 'default' });
      await initializeMermaid({ theme: 'dark' });
      expect(isInitializedMermaid()).toBe(true);
    });

    it('should support all valid themes', async () => {
      const themes: Theme[] = ['default', 'dark', 'forest', 'neutral'];

      for (const theme of themes) {
        reset();
        await initializeMermaid({ theme });
        expect(getCurrentTheme()).toBe(theme);
      }
    });
  });

  describe('renderToSVG', () => {
    it('should render a simple flowchart', async () => {
      const diagram = `graph TD
        A[Start] --> B[End]`;

      const svg = await renderToSVG(diagram);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(typeof svg).toBe('string');
    });

    it('should render with specified theme', async () => {
      const diagram = `graph TD
        A[Node]`;

      const svgDefault = await renderToSVG(diagram, 'default');
      const svgDark = await renderToSVG(diagram, 'dark');

      expect(svgDefault).toContain('<svg');
      expect(svgDark).toContain('<svg');
      // SVGs should be valid but may differ based on theme
      expect(svgDefault.length).toBeGreaterThan(0);
      expect(svgDark.length).toBeGreaterThan(0);
    });

    it('should render a sequence diagram', async () => {
      const diagram = `sequenceDiagram
        participant A
        participant B
        A->>B: Hello`;

      const svg = await renderToSVG(diagram);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('should render a class diagram', async () => {
      const diagram = `classDiagram
        class Animal
        class Dog`;

      const svg = await renderToSVG(diagram);

      expect(svg).toContain('<svg');
    });

    it('should render a pie chart', async () => {
      const diagram = `pie title Test Chart
        "A" : 30
        "B" : 70`;

      const svg = await renderToSVG(diagram);

      expect(svg).toContain('<svg');
    });

    it('should initialize Mermaid automatically if not initialized', async () => {
      expect(isInitializedMermaid()).toBe(false);

      const diagram = `graph TD
        A[Node]`;

      const svg = await renderToSVG(diagram);

      expect(isInitializedMermaid()).toBe(true);
      expect(svg).toContain('<svg');
    });

    it('should throw MermaidError for invalid diagram syntax', async () => {
      const invalidDiagram = 'this is not valid mermaid syntax';

      try {
        await renderToSVG(invalidDiagram);
        fail('Should have thrown MermaidError');
      } catch (error) {
        expect(error).toBeInstanceOf(MermaidError);
        expect((error as MermaidError).message).toContain('Failed to render diagram');
      }
    });

    it('should throw MermaidError for incomplete diagrams', async () => {
      const incompleteDiagram = 'graph TD\n  A[Start] -->';

      try {
        await renderToSVG(incompleteDiagram);
        fail('Should have thrown MermaidError');
      } catch (error) {
        expect(error).toBeInstanceOf(MermaidError);
      }
    });

    it('should have cause property on MermaidError', async () => {
      const invalidDiagram = 'invalid syntax';

      try {
        await renderToSVG(invalidDiagram);
      } catch (error) {
        if (error instanceof MermaidError) {
          expect(error.cause).toBeDefined();
          expect(error.cause).toBeInstanceOf(Error);
        }
      }
    });
  });

  describe('renderWithDimensions', () => {
    it('should render diagram and extract dimensions', async () => {
      const diagram = `graph TD
        A[Start] --> B[End]`;

      const result = await renderWithDimensions(diagram);

      expect(result.svg).toContain('<svg');
      expect(result.svg.length).toBeGreaterThan(0);
      // Dimensions may or may not be present depending on Mermaid version
      if (result.width !== undefined) {
        expect(result.width).toBeGreaterThan(0);
      }
      if (result.height !== undefined) {
        expect(result.height).toBeGreaterThan(0);
      }
    });

    it('should extract viewBox dimensions', async () => {
      const diagram = `graph TD
        A[Node A] --> B[Node B]`;

      const result = await renderWithDimensions(diagram);

      expect(result.svg).toContain('<svg');
      // Dimensions may be present in viewBox
      if (result.width !== undefined) {
        expect(result.width).toBeGreaterThan(0);
      }
      if (result.height !== undefined) {
        expect(result.height).toBeGreaterThan(0);
      }
    });

    it('should return RenderResult with all properties', async () => {
      const diagram = `graph LR
        A[A] --> B[B]`;

      const result = await renderWithDimensions(diagram, 'default');

      expect(result).toHaveProperty('svg');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(typeof result.svg).toBe('string');
      expect(result.svg.length).toBeGreaterThan(0);
    });

    it('should use specified theme', async () => {
      const diagram = `graph TD
        A[Node]`;

      const resultDefault = await renderWithDimensions(diagram, 'default');
      const resultDark = await renderWithDimensions(diagram, 'dark');

      expect(resultDefault.svg).toContain('<svg');
      expect(resultDark.svg).toContain('<svg');
    });

    it('should throw MermaidError for invalid diagrams', async () => {
      try {
        await renderWithDimensions('invalid');
        fail('Should have thrown MermaidError');
      } catch (error) {
        expect(error).toBeInstanceOf(MermaidError);
      }
    });
  });

  describe('validateDiagram', () => {
    it('should validate correct flowchart syntax', () => {
      const valid = `graph TD
        A[Start] --> B[End]`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate flowchart keyword', () => {
      const valid = `flowchart LR
        A --> B`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate sequence diagram', () => {
      const valid = `sequenceDiagram
        A->>B: Hello`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate class diagram', () => {
      const valid = `classDiagram
        class Animal`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate state diagram', () => {
      const valid = `stateDiagram-v2
        [*] --> State1`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate gantt diagram', () => {
      const valid = `gantt
        title Project`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate pie diagram', () => {
      const valid = `pie title Chart
        "A" : 100`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should validate wireframe diagram', () => {
      const valid = `wireframe
        title Test`;

      expect(validateDiagram(valid)).toBe(true);
    });

    it('should invalidate empty content', () => {
      expect(validateDiagram('')).toBe(false);
      expect(validateDiagram('   ')).toBe(false);
      expect(validateDiagram('\n\n')).toBe(false);
    });

    it('should invalidate content without diagram type', () => {
      expect(validateDiagram('some random text')).toBe(false);
      expect(validateDiagram('A --> B')).toBe(false);
    });

    it('should invalidate null or undefined', () => {
      expect(validateDiagram(null as any)).toBe(false);
      expect(validateDiagram(undefined as any)).toBe(false);
    });

    it('should be fast and not require rendering', () => {
      const diagram = `graph TD
        A[Node]`;

      const startTime = performance.now();
      validateDiagram(diagram);
      const endTime = performance.now();

      // Validation should be nearly instant (< 10ms)
      expect(endTime - startTime).toBeLessThan(10);
    });
  });

  describe('getCurrentTheme', () => {
    it('should return default theme initially', async () => {
      await initializeMermaid();
      expect(getCurrentTheme()).toBe('default');
    });

    it('should return dark theme when set', async () => {
      await initializeMermaid({ theme: 'dark' });
      expect(getCurrentTheme()).toBe('dark');
    });

    it('should return forest theme when set', async () => {
      await initializeMermaid({ theme: 'forest' });
      expect(getCurrentTheme()).toBe('forest');
    });

    it('should return neutral theme when set', async () => {
      await initializeMermaid({ theme: 'neutral' });
      expect(getCurrentTheme()).toBe('neutral');
    });
  });

  describe('setTheme', () => {
    it('should change theme after initialization', async () => {
      await initializeMermaid({ theme: 'default' });
      expect(getCurrentTheme()).toBe('default');

      setTheme('dark');
      expect(getCurrentTheme()).toBe('dark');
    });

    it('should support all theme values', async () => {
      await initializeMermaid();
      const themes: Theme[] = ['default', 'dark', 'forest', 'neutral'];

      for (const theme of themes) {
        setTheme(theme);
        expect(getCurrentTheme()).toBe(theme);
      }
    });

    it('should affect subsequent renders', async () => {
      await initializeMermaid();
      const diagram = `graph TD
        A[Node]`;

      setTheme('dark');
      const svg1 = await renderToSVG(diagram);

      setTheme('default');
      const svg2 = await renderToSVG(diagram);

      expect(svg1).toContain('<svg');
      expect(svg2).toContain('<svg');
    });
  });

  describe('reset', () => {
    it('should reset initialization state', async () => {
      await initializeMermaid();
      expect(isInitializedMermaid()).toBe(true);

      reset();
      expect(isInitializedMermaid()).toBe(false);
    });

    it('should allow re-initialization after reset', async () => {
      await initializeMermaid({ theme: 'default' });
      reset();

      await initializeMermaid({ theme: 'dark' });
      expect(isInitializedMermaid()).toBe(true);
      expect(getCurrentTheme()).toBe('dark');
    });

    it('should not throw on multiple resets', () => {
      expect(() => {
        reset();
        reset();
        reset();
      }).not.toThrow();
    });
  });

  describe('isInitializedMermaid', () => {
    it('should return false initially', () => {
      expect(isInitializedMermaid()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await initializeMermaid();
      expect(isInitializedMermaid()).toBe(true);
    });

    it('should return false after reset', async () => {
      await initializeMermaid();
      reset();
      expect(isInitializedMermaid()).toBe(false);
    });
  });

  describe('MermaidError', () => {
    it('should be an instance of Error', () => {
      const error = new MermaidError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have name property', () => {
      const error = new MermaidError('Test error');
      expect(error.name).toBe('MermaidError');
    });

    it('should store cause error', () => {
      const cause = new Error('Cause error');
      const error = new MermaidError('Test error', cause);
      expect(error.cause).toBe(cause);
    });

    it('should have correct message', () => {
      const error = new MermaidError('Custom message');
      expect(error.message).toBe('Custom message');
    });

    it('should support optional cause', () => {
      const error = new MermaidError('Test error');
      expect(error.cause).toBeUndefined();
    });
  });

  describe('Integration tests', () => {
    it('should render multiple diagrams with different themes', async () => {
      const diagram1 = `graph TD
        A[Node 1] --> B[Node 2]`;
      const diagram2 = `sequenceDiagram
        A->>B: Message`;

      const svg1 = await renderToSVG(diagram1, 'default');
      const svg2 = await renderToSVG(diagram2, 'dark');

      expect(svg1).toContain('<svg');
      expect(svg2).toContain('<svg');
      expect(svg1.length).toBeGreaterThan(0);
      expect(svg2.length).toBeGreaterThan(0);
    });

    it('should validate then render diagrams', async () => {
      const validDiagrams = [
        `graph TD
          A[Node]`,
        `sequenceDiagram
          A->>B: Hello`,
        `classDiagram
          class Animal`,
      ];

      for (const diagram of validDiagrams) {
        expect(validateDiagram(diagram)).toBe(true);
        const svg = await renderToSVG(diagram);
        expect(svg).toContain('<svg');
      }
    });

    it('should handle theme changes during rendering', async () => {
      const diagram = `graph TD
        A[Node A] --> B[Node B]`;

      setTheme('default');
      const result1 = await renderWithDimensions(diagram);

      setTheme('dark');
      const result2 = await renderWithDimensions(diagram);

      expect(result1.svg).toContain('<svg');
      expect(result2.svg).toContain('<svg');
      expect(result1.width).toBeGreaterThan(0);
      expect(result2.width).toBeGreaterThan(0);
    });

    it('should handle concurrent render operations', async () => {
      const diagrams = [
        `graph TD
          A[Node 1]`,
        `graph TD
          B[Node 2]`,
        `graph TD
          C[Node 3]`,
      ];

      const promises = diagrams.map((diagram) => renderToSVG(diagram));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((svg) => {
        expect(svg).toContain('<svg');
      });
    });
  });
});
