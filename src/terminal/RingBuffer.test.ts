import { describe, it, expect } from 'vitest';
import { RingBuffer } from './RingBuffer';

describe('RingBuffer', () => {
  describe('constructor', () => {
    it('should initialize with default maxLines of 10,000', () => {
      const buffer = new RingBuffer();
      expect(buffer.lineCount).toBe(0);
    });

    it('should initialize with custom maxLines', () => {
      const buffer = new RingBuffer(100);
      expect(buffer.lineCount).toBe(0);
    });
  });

  describe('write', () => {
    it('should handle empty string without error', () => {
      const buffer = new RingBuffer();
      buffer.write('');
      expect(buffer.lineCount).toBe(0);
    });

    it('should count lines by newline characters', () => {
      const buffer = new RingBuffer();
      buffer.write('hello\n');
      expect(buffer.lineCount).toBe(1);
    });

    it('should accumulate multiple writes', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n');
      buffer.write('line2\n');
      expect(buffer.lineCount).toBe(2);
    });

    it('should handle data with no newlines as partial content', () => {
      const buffer = new RingBuffer();
      buffer.write('partial');
      expect(buffer.lineCount).toBe(0);
    });

    it('should complete a partial line with newline', () => {
      const buffer = new RingBuffer();
      buffer.write('partial');
      buffer.write(' content\n');
      expect(buffer.lineCount).toBe(1);
    });

    it('should handle multiple newlines in single write', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\nline2\nline3\n');
      expect(buffer.lineCount).toBe(3);
    });

    it('should preserve ANSI escape codes', () => {
      const buffer = new RingBuffer();
      const ansiText = '\u001b[31mred text\u001b[0m\n';
      buffer.write(ansiText);
      expect(buffer.getContents()).toBe(ansiText);
    });

    it('should evict oldest lines when exceeding maxLines', () => {
      const buffer = new RingBuffer(3);
      buffer.write('line1\n');
      buffer.write('line2\n');
      buffer.write('line3\n');
      expect(buffer.lineCount).toBe(3);

      buffer.write('line4\n');
      expect(buffer.lineCount).toBe(3);

      const contents = buffer.getContents();
      expect(contents).not.toContain('line1');
      expect(contents).toContain('line2');
      expect(contents).toContain('line3');
      expect(contents).toContain('line4');
    });

    it('should evict multiple old lines if single write exceeds maxLines', () => {
      const buffer = new RingBuffer(2);
      buffer.write('line1\n');
      buffer.write('line2\n');
      buffer.write('line3\nline4\nline5\n');

      expect(buffer.lineCount).toBe(2);
      const contents = buffer.getContents();
      expect(contents).toContain('line4');
      expect(contents).toContain('line5');
      expect(contents).not.toContain('line1');
      expect(contents).not.toContain('line2');
      expect(contents).not.toContain('line3');
    });
  });

  describe('getContents', () => {
    it('should return empty string for empty buffer', () => {
      const buffer = new RingBuffer();
      expect(buffer.getContents()).toBe('');
    });

    it('should return all buffered content with newlines intact', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n');
      buffer.write('line2\n');
      expect(buffer.getContents()).toBe('line1\nline2\n');
    });

    it('should preserve partial lines without trailing newline', () => {
      const buffer = new RingBuffer();
      buffer.write('complete\n');
      buffer.write('partial');
      expect(buffer.getContents()).toBe('complete\npartial');
    });

    it('should preserve order of written content', () => {
      const buffer = new RingBuffer();
      buffer.write('first\n');
      buffer.write('second\n');
      buffer.write('third\n');
      expect(buffer.getContents()).toBe('first\nsecond\nthird\n');
    });

    it('should preserve ANSI codes in output', () => {
      const buffer = new RingBuffer();
      const ansiLine1 = '\u001b[1;32m$ \u001b[0mecho hello\n';
      const ansiLine2 = '\u001b[0mhello\n';
      buffer.write(ansiLine1);
      buffer.write(ansiLine2);
      expect(buffer.getContents()).toBe(ansiLine1 + ansiLine2);
    });
  });

  describe('clear', () => {
    it('should reset buffer to empty state', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n');
      buffer.write('line2\n');
      expect(buffer.lineCount).toBe(2);

      buffer.clear();
      expect(buffer.lineCount).toBe(0);
      expect(buffer.getContents()).toBe('');
    });

    it('should allow writing after clear', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n');
      buffer.clear();
      buffer.write('line2\n');

      expect(buffer.lineCount).toBe(1);
      expect(buffer.getContents()).toBe('line2\n');
    });
  });

  describe('lineCount getter', () => {
    it('should return 0 for empty buffer', () => {
      const buffer = new RingBuffer();
      expect(buffer.lineCount).toBe(0);
    });

    it('should reflect actual line count after writes', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n');
      expect(buffer.lineCount).toBe(1);

      buffer.write('line2\nline3\n');
      expect(buffer.lineCount).toBe(3);
    });

    it('should not count partial lines', () => {
      const buffer = new RingBuffer();
      buffer.write('partial');
      expect(buffer.lineCount).toBe(0);

      buffer.write('\n');
      expect(buffer.lineCount).toBe(1);
    });

    it('should update after clear', () => {
      const buffer = new RingBuffer();
      buffer.write('line\n');
      buffer.clear();
      expect(buffer.lineCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle consecutive newlines', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\n\n\nline2\n');
      expect(buffer.lineCount).toBe(4);
    });

    it('should handle windows line endings', () => {
      const buffer = new RingBuffer();
      buffer.write('line1\r\nline2\r\n');
      // Should count \n, not \r\n
      expect(buffer.lineCount).toBe(2);
    });

    it('should handle very large single write', () => {
      const buffer = new RingBuffer(10);
      let data = '';
      for (let i = 0; i < 20; i++) {
        data += `line${i}\n`;
      }
      buffer.write(data);
      expect(buffer.lineCount).toBe(10);
    });

    it('should handle maxLines of 1', () => {
      const buffer = new RingBuffer(1);
      buffer.write('line1\n');
      expect(buffer.lineCount).toBe(1);

      buffer.write('line2\n');
      expect(buffer.lineCount).toBe(1);
      expect(buffer.getContents()).toBe('line2\n');
    });

    it('should handle mixed content with special characters', () => {
      const buffer = new RingBuffer();
      buffer.write('tab\there\n');
      buffer.write('quote"here\n');
      buffer.write("single'here\n");
      expect(buffer.lineCount).toBe(3);
      expect(buffer.getContents()).toContain('tab\there');
      expect(buffer.getContents()).toContain('quote"here');
      expect(buffer.getContents()).toContain("single'here");
    });
  });
});
