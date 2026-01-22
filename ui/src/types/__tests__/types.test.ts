/**
 * Core Types Test Suite
 * Verifies that all types are properly defined and exported
 */

import {
  Session,
  CollabState,
  VerificationIssue,
  Diagram,
  DiagramValidation,
  Document,
} from '../index';

describe('Session Types', () => {
  describe('Session interface', () => {
    it('should have required properties', () => {
      const session: Session = {
        project: '/path/to/project',
        name: 'test-session',
      };

      expect(session.project).toBeDefined();
      expect(session.name).toBeDefined();
    });

    it('should support optional properties', () => {
      const session: Session = {
        project: '/path/to/project',
        name: 'test-session',
        phase: 'phase-1',
        lastActivity: '2024-01-21T10:30:00Z',
        itemCount: 5,
      };

      expect(session.phase).toBe('phase-1');
      expect(session.lastActivity).toBe('2024-01-21T10:30:00Z');
      expect(session.itemCount).toBe(5);
    });
  });

  describe('CollabState interface', () => {
    it('should have required properties', () => {
      const state: CollabState = {
        phase: 'brainstorming',
        lastActivity: '2024-01-21T10:30:00Z',
        currentItem: null,
      };

      expect(state.phase).toBeDefined();
      expect(state.lastActivity).toBeDefined();
      expect(state.currentItem).toBeNull();
    });

    it('should support optional properties', () => {
      const state: CollabState = {
        phase: 'implementation',
        lastActivity: '2024-01-21T10:30:00Z',
        currentItem: 1,
        worktreePath: '/path/to/worktree',
        pendingVerificationIssues: [],
      };

      expect(state.currentItem).toBe(1);
      expect(state.worktreePath).toBe('/path/to/worktree');
      expect(state.pendingVerificationIssues).toEqual([]);
    });
  });

  describe('VerificationIssue interface', () => {
    it('should have all required properties', () => {
      const issue: VerificationIssue = {
        type: 'drift',
        phase: 'implementation',
        description: 'File was modified outside session',
        file: 'src/components/Button.tsx',
        detectedAt: '2024-01-21T10:30:00Z',
      };

      expect(issue.type).toBe('drift');
      expect(issue.phase).toBe('implementation');
      expect(issue.description).toBeDefined();
      expect(issue.file).toBeDefined();
      expect(issue.detectedAt).toBeDefined();
    });
  });
});

describe('Diagram Types', () => {
  describe('Diagram interface', () => {
    it('should have required properties', () => {
      const diagram: Diagram = {
        id: 'diagram-123',
        name: 'Architecture Diagram',
        content: 'graph TD\n  A --> B',
        lastModified: Date.now(),
      };

      expect(diagram.id).toBeDefined();
      expect(diagram.name).toBeDefined();
      expect(diagram.content).toBeDefined();
      expect(diagram.lastModified).toBeDefined();
    });

    it('should support optional properties', () => {
      const diagram: Diagram = {
        id: 'diagram-123',
        name: 'Architecture Diagram',
        content: 'graph TD\n  A --> B',
        lastModified: Date.now(),
        folder: 'designs',
        locked: false,
      };

      expect(diagram.folder).toBe('designs');
      expect(diagram.locked).toBe(false);
    });

    it('should allow lastModified as timestamp', () => {
      const timestamp = 1705844400000;
      const diagram: Diagram = {
        id: 'diagram-123',
        name: 'Test',
        content: 'test',
        lastModified: timestamp,
      };

      expect(diagram.lastModified).toBe(timestamp);
      expect(typeof diagram.lastModified).toBe('number');
    });
  });

  describe('DiagramValidation interface', () => {
    it('should represent valid diagram', () => {
      const validation: DiagramValidation = {
        valid: true,
      };

      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });

    it('should represent invalid diagram with error', () => {
      const validation: DiagramValidation = {
        valid: false,
        error: 'Unexpected token at line 3',
        line: 3,
      };

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();
      expect(validation.line).toBe(3);
    });
  });
});

describe('Document Types', () => {
  describe('Document interface', () => {
    it('should have required properties', () => {
      const document: Document = {
        id: 'doc-123',
        name: 'Design Document',
        content: '# Design\n\nThis is a design doc.',
        lastModified: Date.now(),
      };

      expect(document.id).toBeDefined();
      expect(document.name).toBeDefined();
      expect(document.content).toBeDefined();
      expect(document.lastModified).toBeDefined();
    });

    it('should support optional properties', () => {
      const document: Document = {
        id: 'doc-123',
        name: 'Design Document',
        content: '# Design\n\nThis is a design doc.',
        lastModified: Date.now(),
        folder: 'docs',
        locked: true,
      };

      expect(document.folder).toBe('docs');
      expect(document.locked).toBe(true);
    });

    it('should have same structure as Diagram', () => {
      const diagram: Diagram = {
        id: 'id1',
        name: 'name1',
        content: 'content1',
        lastModified: 1000,
        folder: 'folder1',
        locked: false,
      };

      const document: Document = {
        id: 'id2',
        name: 'name2',
        content: 'content2',
        lastModified: 2000,
        folder: 'folder2',
        locked: true,
      };

      // Both should have the same properties
      expect(Object.keys(document).sort()).toEqual(Object.keys(diagram).sort());
    });
  });
});

describe('Type Exports', () => {
  it('should export all session types', () => {
    const session: Session = { project: 'p', name: 'n' };
    const state: CollabState = { phase: 'p', lastActivity: 'a', currentItem: null };
    const issue: VerificationIssue = {
      type: 'drift',
      phase: 'p',
      description: 'd',
      file: 'f',
      detectedAt: 'a',
    };

    expect(session).toBeDefined();
    expect(state).toBeDefined();
    expect(issue).toBeDefined();
  });

  it('should export all diagram types', () => {
    const diagram: Diagram = { id: 'i', name: 'n', content: 'c', lastModified: 1 };
    const validation: DiagramValidation = { valid: true };

    expect(diagram).toBeDefined();
    expect(validation).toBeDefined();
  });

  it('should export all document types', () => {
    const document: Document = { id: 'i', name: 'n', content: 'c', lastModified: 1 };

    expect(document).toBeDefined();
  });
});

describe('Type Compatibility', () => {
  it('should allow type narrowing based on properties', () => {
    const item: Diagram | Document = {
      id: 'item-1',
      name: 'Item',
      content: 'content',
      lastModified: Date.now(),
    };

    // Both types have these properties, so we can access them without narrowing
    expect(item.id).toBeDefined();
    expect(item.name).toBeDefined();
    expect(item.content).toBeDefined();
    expect(item.lastModified).toBeDefined();
  });

  it('should support array of mixed session data', () => {
    const sessions: Session[] = [
      { project: 'p1', name: 's1' },
      { project: 'p2', name: 's2', phase: 'phase-1', itemCount: 3 },
    ];

    expect(sessions).toHaveLength(2);
    expect(sessions[0].project).toBe('p1');
    expect(sessions[1].phase).toBe('phase-1');
  });

  it('should support mixed arrays of diagrams and documents', () => {
    const diagram: Diagram = {
      id: 'd1',
      name: 'Diagram',
      content: 'graph',
      lastModified: 1000,
    };

    const document: Document = {
      id: 'doc1',
      name: 'Doc',
      content: 'markdown',
      lastModified: 2000,
    };

    const items: (Diagram | Document)[] = [diagram, document];

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('d1');
    expect(items[1].id).toBe('doc1');
  });
});

describe('Type Validation Scenarios', () => {
  it('should handle empty optional fields', () => {
    const diagram: Diagram = {
      id: 'id',
      name: 'name',
      content: 'content',
      lastModified: 0,
      folder: undefined,
      locked: undefined,
    };

    expect(diagram.folder).toBeUndefined();
    expect(diagram.locked).toBeUndefined();
  });

  it('should handle sessions with null currentItem', () => {
    const state: CollabState = {
      phase: 'p',
      lastActivity: 'a',
      currentItem: null,
    };

    expect(state.currentItem).toBeNull();
  });

  it('should handle sessions with numeric currentItem', () => {
    const state: CollabState = {
      phase: 'p',
      lastActivity: 'a',
      currentItem: 42,
    };

    expect(state.currentItem).toBe(42);
  });

  it('should handle empty verification issues array', () => {
    const state: CollabState = {
      phase: 'p',
      lastActivity: 'a',
      currentItem: null,
      pendingVerificationIssues: [],
    };

    expect(state.pendingVerificationIssues).toHaveLength(0);
  });

  it('should handle multiple verification issues', () => {
    const issues: VerificationIssue[] = [
      {
        type: 'drift',
        phase: 'p1',
        description: 'd1',
        file: 'f1',
        detectedAt: 'a1',
      },
      {
        type: 'drift',
        phase: 'p2',
        description: 'd2',
        file: 'f2',
        detectedAt: 'a2',
      },
    ];

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.type === 'drift')).toBe(true);
  });
});
