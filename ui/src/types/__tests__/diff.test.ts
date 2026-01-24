/**
 * Diff Types Test Suite
 * Verifies that all diff-related types are properly defined and exported
 */

import {
  DiffState,
  DocumentHistory,
  PatchNotification,
} from '../diff';

describe('Diff Types', () => {
  describe('DiffState interface', () => {
    it('should have required properties', () => {
      const state: DiffState = {
        showDiff: true,
        oldContent: 'old',
        newContent: 'new',
      };

      expect(state.showDiff).toBeDefined();
      expect(state.oldContent).toBeDefined();
      expect(state.newContent).toBeDefined();
    });

    it('should allow null for oldContent', () => {
      const state: DiffState = {
        showDiff: false,
        oldContent: null,
        newContent: null,
      };

      expect(state.oldContent).toBeNull();
      expect(state.newContent).toBeNull();
    });

    it('should allow true/false for showDiff', () => {
      const stateTrue: DiffState = {
        showDiff: true,
        oldContent: 'old',
        newContent: 'new',
      };

      const stateFalse: DiffState = {
        showDiff: false,
        oldContent: null,
        newContent: null,
      };

      expect(stateTrue.showDiff).toBe(true);
      expect(stateFalse.showDiff).toBe(false);
    });
  });

  describe('DocumentHistory interface', () => {
    it('should have required properties', () => {
      const history: DocumentHistory = {
        previous: 'old',
        current: 'new',
        hasDiff: true,
      };

      expect(history.previous).toBeDefined();
      expect(history.current).toBeDefined();
      expect(history.hasDiff).toBeDefined();
    });

    it('should allow null for previous', () => {
      const history: DocumentHistory = {
        previous: null,
        current: 'content',
        hasDiff: false,
      };

      expect(history.previous).toBeNull();
    });

    it('should require current content', () => {
      const history: DocumentHistory = {
        previous: null,
        current: 'some content',
        hasDiff: false,
      };

      expect(history.current).toBe('some content');
    });

    it('should track diff state correctly', () => {
      const withDiff: DocumentHistory = {
        previous: 'old content',
        current: 'new content',
        hasDiff: true,
      };

      const noDiff: DocumentHistory = {
        previous: null,
        current: 'content',
        hasDiff: false,
      };

      expect(withDiff.hasDiff).toBe(true);
      expect(noDiff.hasDiff).toBe(false);
    });

    it('should handle empty strings', () => {
      const history: DocumentHistory = {
        previous: '',
        current: '',
        hasDiff: false,
      };

      expect(history.previous).toBe('');
      expect(history.current).toBe('');
    });

    it('should handle multiline content', () => {
      const history: DocumentHistory = {
        previous: 'line 1\nline 2',
        current: 'line 1\nline 2\nline 3',
        hasDiff: true,
      };

      expect(history.previous).toContain('\n');
      expect(history.current).toContain('\n');
    });
  });

  describe('PatchNotification interface', () => {
    it('should have required properties', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'old',
        newContent: 'new',
        patchApplied: {
          old_string: 'old',
          new_string: 'new',
        },
      };

      expect(notification.type).toBe('patch');
      expect(notification.documentId).toBeDefined();
      expect(notification.oldContent).toBeDefined();
      expect(notification.newContent).toBeDefined();
      expect(notification.patchApplied).toBeDefined();
    });

    it('should enforce type to be "patch"', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'old',
        newContent: 'new',
        patchApplied: {
          old_string: 'old',
          new_string: 'new',
        },
      };

      expect(notification.type).toBe('patch');
    });

    it('should require valid documentId', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'valid-doc-id-123',
        oldContent: 'old',
        newContent: 'new',
        patchApplied: {
          old_string: 'old',
          new_string: 'new',
        },
      };

      expect(notification.documentId).toBe('valid-doc-id-123');
    });

    it('should contain oldContent and newContent', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'original content here',
        newContent: 'modified content here',
        patchApplied: {
          old_string: 'original',
          new_string: 'modified',
        },
      };

      expect(notification.oldContent).toBe('original content here');
      expect(notification.newContent).toBe('modified content here');
    });

    it('should contain patchApplied with old_string and new_string', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'old',
        newContent: 'new',
        patchApplied: {
          old_string: 'search term',
          new_string: 'replacement term',
        },
      };

      expect(notification.patchApplied.old_string).toBe('search term');
      expect(notification.patchApplied.new_string).toBe('replacement term');
    });

    it('should handle multiline content in patch', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'line 1\nline 2\nline 3',
        newContent: 'line 1\nmodified\nline 3',
        patchApplied: {
          old_string: 'line 2',
          new_string: 'modified',
        },
      };

      expect(notification.oldContent).toContain('\n');
      expect(notification.newContent).toContain('\n');
      expect(notification.patchApplied.old_string).toBe('line 2');
    });

    it('should support empty strings in patch', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'content with extra text',
        newContent: 'content',
        patchApplied: {
          old_string: ' with extra text',
          new_string: '',
        },
      };

      expect(notification.patchApplied.new_string).toBe('');
    });

    it('should handle special characters in patch', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'content with $pecial ch@rs!',
        newContent: 'content with normal chars',
        patchApplied: {
          old_string: '$pecial ch@rs!',
          new_string: 'normal chars',
        },
      };

      expect(notification.patchApplied.old_string).toBe('$pecial ch@rs!');
      expect(notification.patchApplied.new_string).toBe('normal chars');
    });
  });

  describe('Type Compatibility', () => {
    it('should work with DiffState and DocumentHistory together', () => {
      const state: DiffState = {
        showDiff: true,
        oldContent: 'old',
        newContent: 'new',
      };

      const history: DocumentHistory = {
        previous: state.oldContent,
        current: state.newContent,
        hasDiff: state.showDiff,
      };

      expect(history.previous).toBe(state.oldContent);
      expect(history.current).toBe(state.newContent);
      expect(history.hasDiff).toBe(state.showDiff);
    });

    it('should work with DocumentHistory and PatchNotification together', () => {
      const notification: PatchNotification = {
        type: 'patch',
        documentId: 'doc-1',
        oldContent: 'old',
        newContent: 'new',
        patchApplied: {
          old_string: 'old',
          new_string: 'new',
        },
      };

      const history: DocumentHistory = {
        previous: notification.oldContent,
        current: notification.newContent,
        hasDiff: notification.oldContent !== notification.newContent,
      };

      expect(history.previous).toBe(notification.oldContent);
      expect(history.current).toBe(notification.newContent);
    });
  });
});
