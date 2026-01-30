import {
  Viewport,
  Direction,
  ButtonVariant,
  WireframeRoot,
  BaseComponent,
  ScreenComponent,
  ColComponent,
  RowComponent,
  CardComponent,
  ButtonComponent,
  InputComponent,
  TextComponent,
  LayoutBounds,
  RenderContext,
  WireframeComponent,
} from '../wireframe';

describe('Wireframe Types', () => {
  describe('Viewport type', () => {
    it('should accept valid viewport values', () => {
      const mobile: Viewport = 'mobile';
      const tablet: Viewport = 'tablet';
      const desktop: Viewport = 'desktop';

      expect(mobile).toBe('mobile');
      expect(tablet).toBe('tablet');
      expect(desktop).toBe('desktop');
    });
  });

  describe('Direction type', () => {
    it('should accept valid direction values', () => {
      const lr: Direction = 'LR';
      const td: Direction = 'TD';

      expect(lr).toBe('LR');
      expect(td).toBe('TD');
    });
  });

  describe('ButtonVariant type', () => {
    it('should accept all button variant values', () => {
      const variants: ButtonVariant[] = [
        'default',
        'primary',
        'secondary',
        'danger',
        'success',
        'disabled',
      ];

      expect(variants).toHaveLength(6);
      expect(variants).toContain('primary');
      expect(variants).toContain('danger');
    });
  });

  describe('LayoutBounds interface', () => {
    it('should create valid layout bounds', () => {
      const bounds: LayoutBounds = {
        x: 10,
        y: 20,
        width: 300,
        height: 400,
      };

      expect(bounds.x).toBe(10);
      expect(bounds.y).toBe(20);
      expect(bounds.width).toBe(300);
      expect(bounds.height).toBe(400);
    });
  });

  describe('BaseComponent interface', () => {
    it('should create valid base component', () => {
      const base: BaseComponent = {
        id: 'comp-1',
        type: 'text',
        bounds: { x: 0, y: 0, width: 100, height: 50 },
      };

      expect(base.id).toBe('comp-1');
      expect(base.type).toBe('text');
      expect(base.bounds).toBeDefined();
    });

    it('should support optional properties', () => {
      const base: BaseComponent = {
        id: 'comp-2',
        type: 'button',
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        label: 'Click me',
      };

      expect(base.label).toBe('Click me');
    });
  });

  describe('ScreenComponent interface', () => {
    it('should create valid screen component', () => {
      const screen: ScreenComponent = {
        id: 'screen-1',
        type: 'screen',
        bounds: { x: 0, y: 0, width: 375, height: 667 },
        name: 'Login Screen',
        children: [],
      };

      expect(screen.type).toBe('screen');
      expect(screen.name).toBe('Login Screen');
      expect(screen.children).toEqual([]);
    });

    it('should support optional properties on screen', () => {
      const screen: ScreenComponent = {
        id: 'screen-2',
        type: 'screen',
        bounds: { x: 0, y: 0, width: 375, height: 667 },
        name: 'Home',
        backgroundColor: '#ffffff',
        children: [],
      };

      expect(screen.backgroundColor).toBe('#ffffff');
    });
  });

  describe('ColComponent interface', () => {
    it('should create valid col component', () => {
      const col: ColComponent = {
        id: 'col-1',
        type: 'col',
        bounds: { x: 0, y: 0, width: 100, height: 200 },
        children: [],
      };

      expect(col.type).toBe('col');
      expect(col.children).toEqual([]);
    });

    it('should support layout properties', () => {
      const col: ColComponent = {
        id: 'col-2',
        type: 'col',
        bounds: { x: 0, y: 0, width: 100, height: 200 },
        gap: 8,
        padding: 16,
        children: [],
      };

      expect(col.gap).toBe(8);
      expect(col.padding).toBe(16);
    });
  });

  describe('RowComponent interface', () => {
    it('should create valid row component', () => {
      const row: RowComponent = {
        id: 'row-1',
        type: 'row',
        bounds: { x: 0, y: 0, width: 300, height: 100 },
        children: [],
      };

      expect(row.type).toBe('row');
      expect(row.children).toEqual([]);
    });

    it('should support layout properties', () => {
      const row: RowComponent = {
        id: 'row-2',
        type: 'row',
        bounds: { x: 0, y: 0, width: 300, height: 100 },
        gap: 12,
        padding: 8,
        children: [],
      };

      expect(row.gap).toBe(12);
      expect(row.padding).toBe(8);
    });
  });

  describe('ButtonComponent interface', () => {
    it('should create valid button component', () => {
      const button: ButtonComponent = {
        id: 'btn-1',
        type: 'button',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        label: 'Submit',
      };

      expect(button.type).toBe('button');
      expect(button.label).toBe('Submit');
    });

    it('should support button variant', () => {
      const button: ButtonComponent = {
        id: 'btn-2',
        type: 'button',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        label: 'Delete',
        variant: 'danger',
      };

      expect(button.variant).toBe('danger');
    });

    it('should support disabled state', () => {
      const button: ButtonComponent = {
        id: 'btn-3',
        type: 'button',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        label: 'Disabled',
        disabled: true,
      };

      expect(button.disabled).toBe(true);
    });
  });

  describe('InputComponent interface', () => {
    it('should create valid input component', () => {
      const input: InputComponent = {
        id: 'input-1',
        type: 'input',
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };

      expect(input.type).toBe('input');
    });

    it('should support input properties', () => {
      const input: InputComponent = {
        id: 'input-2',
        type: 'input',
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        placeholder: 'Enter text',
        value: 'Hello',
        inputType: 'email',
      };

      expect(input.placeholder).toBe('Enter text');
      expect(input.value).toBe('Hello');
      expect(input.inputType).toBe('email');
    });

    it('should support disabled state', () => {
      const input: InputComponent = {
        id: 'input-3',
        type: 'input',
        bounds: { x: 0, y: 0, width: 200, height: 40 },
        disabled: true,
      };

      expect(input.disabled).toBe(true);
    });
  });

  describe('TextComponent interface', () => {
    it('should create valid text component', () => {
      const text: TextComponent = {
        id: 'text-1',
        type: 'text',
        bounds: { x: 0, y: 0, width: 150, height: 30 },
        content: 'Hello World',
      };

      expect(text.type).toBe('text');
      expect(text.content).toBe('Hello World');
    });

    it('should support text styling', () => {
      const text: TextComponent = {
        id: 'text-2',
        type: 'text',
        bounds: { x: 0, y: 0, width: 150, height: 30 },
        content: 'Title',
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000000',
      };

      expect(text.fontSize).toBe(24);
      expect(text.fontWeight).toBe('bold');
      expect(text.color).toBe('#000000');
    });
  });

  describe('RenderContext interface', () => {
    it('should create valid render context', () => {
      const context: RenderContext = {
        canvas: document.createElement('canvas'),
        rc: {} as any, // rough.js RC object
        viewport: 'mobile',
        scale: 1,
      };

      expect(context.canvas).toBeDefined();
      expect(context.viewport).toBe('mobile');
      expect(context.scale).toBe(1);
    });

    it('should support custom render options', () => {
      const context: RenderContext = {
        canvas: document.createElement('canvas'),
        rc: {} as any,
        viewport: 'desktop',
        scale: 1.5,
        theme: 'dark',
      };

      expect(context.scale).toBe(1.5);
      expect(context.theme).toBe('dark');
    });
  });

  describe('WireframeRoot interface', () => {
    it('should create valid wireframe root', () => {
      const root: WireframeRoot = {
        viewport: 'mobile',
        direction: 'TD',
        screens: [],
      };

      expect(root.viewport).toBe('mobile');
      expect(root.direction).toBe('TD');
      expect(root.screens).toEqual([]);
    });

    it('should support multiple screens', () => {
      const root: WireframeRoot = {
        viewport: 'tablet',
        direction: 'LR',
        screens: [
          {
            id: 'screen-1',
            type: 'screen',
            bounds: { x: 0, y: 0, width: 768, height: 1024 },
            name: 'Home',
            children: [],
          },
          {
            id: 'screen-2',
            type: 'screen',
            bounds: { x: 0, y: 0, width: 768, height: 1024 },
            name: 'Detail',
            children: [],
          },
        ],
      };

      expect(root.screens).toHaveLength(2);
      expect(root.screens[0].name).toBe('Home');
    });
  });

  describe('WireframeComponent union type', () => {
    it('should accept screen component', () => {
      const component: WireframeComponent = {
        id: 'screen-1',
        type: 'screen',
        bounds: { x: 0, y: 0, width: 375, height: 667 },
        name: 'Home',
        children: [],
      };

      expect(component.type).toBe('screen');
    });

    it('should accept col component', () => {
      const component: WireframeComponent = {
        id: 'col-1',
        type: 'col',
        bounds: { x: 0, y: 0, width: 100, height: 200 },
        children: [],
      };

      expect(component.type).toBe('col');
    });

    it('should accept row component', () => {
      const component: WireframeComponent = {
        id: 'row-1',
        type: 'row',
        bounds: { x: 0, y: 0, width: 300, height: 100 },
        children: [],
      };

      expect(component.type).toBe('row');
    });

    it('should accept button component', () => {
      const component: WireframeComponent = {
        id: 'btn-1',
        type: 'button',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        label: 'Click',
      };

      expect(component.type).toBe('button');
    });

    it('should accept input component', () => {
      const component: WireframeComponent = {
        id: 'input-1',
        type: 'input',
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };

      expect(component.type).toBe('input');
    });

    it('should accept text component', () => {
      const component: WireframeComponent = {
        id: 'text-1',
        type: 'text',
        bounds: { x: 0, y: 0, width: 150, height: 30 },
        content: 'Hello',
      };

      expect(component.type).toBe('text');
    });

    it('should accept card component', () => {
      const component: WireframeComponent = {
        id: 'card-1',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        children: [],
      };

      expect(component.type).toBe('card');
    });
  });

  describe('CardComponent interface', () => {
    it('should create valid card component', () => {
      const card: CardComponent = {
        id: 'card-1',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        children: [],
      };

      expect(card.type).toBe('card');
      expect(card.children).toEqual([]);
    });

    it('should support optional title', () => {
      const card: CardComponent = {
        id: 'card-2',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        title: 'Card Title',
        children: [],
      };

      expect(card.title).toBe('Card Title');
    });

    it('should support layout properties', () => {
      const card: CardComponent = {
        id: 'card-3',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        gap: 8,
        padding: 16,
        children: [],
      };

      expect(card.gap).toBe(8);
      expect(card.padding).toBe(16);
    });

    it('should support nested children', () => {
      const card: CardComponent = {
        id: 'card-4',
        type: 'card',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        children: [
          {
            id: 'text-1',
            type: 'text',
            content: 'Card content',
            bounds: { x: 0, y: 0, width: 280, height: 30 },
          },
          {
            id: 'btn-1',
            type: 'button',
            label: 'Action',
            bounds: { x: 0, y: 40, width: 100, height: 40 },
          },
        ],
      };

      expect(card.children).toHaveLength(2);
      expect(card.children[0].type).toBe('text');
      expect(card.children[1].type).toBe('button');
    });
  });
});
