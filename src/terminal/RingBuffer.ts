/**
 * Circular buffer storing terminal output for reconnect replay.
 * Maintains a fixed maximum number of lines, evicting oldest when full.
 */
export class RingBuffer {
  private lines: string[];
  private maxLines: number;

  /**
   * Initialize ring buffer with max line limit
   * @param maxLines Maximum number of lines to store (default: 10,000)
   */
  constructor(maxLines: number = 10_000) {
    this.lines = [];
    this.maxLines = maxLines;
  }

  /**
   * Append output data, splitting by newlines and evicting old if full.
   * Handles partial lines correctly - content without newline is not counted
   * as a complete line until it receives one.
   *
   * @param data Raw terminal output (may contain ANSI escape codes)
   */
  write(data: string): void {
    if (!data) {
      return;
    }

    // Split by newline, keeping track of what we're dealing with
    const parts = data.split('\n');

    // Process all complete lines (everything except potentially the last part)
    for (let i = 0; i < parts.length - 1; i++) {
      this.lines.push(parts[i] + '\n');

      // Evict oldest line if we exceed maxLines
      if (this.lines.length > this.maxLines) {
        this.lines.shift();
      }
    }

    // Handle the last part (may be partial, may be empty if data ended with \n)
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      // This is a partial line without trailing newline
      // Append to the last line if it exists, otherwise create new partial line
      if (this.lines.length > 0 && !this.lines[this.lines.length - 1].endsWith('\n')) {
        this.lines[this.lines.length - 1] += lastPart;
      } else {
        this.lines.push(lastPart);

        // Only evict if this partial line pushes us over the limit
        // Note: partial lines don't count toward lineCount
        if (this.lines.length > this.maxLines) {
          this.lines.shift();
        }
      }
    }
  }

  /**
   * Return all buffered content as a single string
   * Preserves line structure and ANSI escape codes
   *
   * @returns Concatenated string of all buffered lines
   */
  getContents(): string {
    return this.lines.join('');
  }

  /**
   * Reset buffer to empty state
   */
  clear(): void {
    this.lines = [];
  }

  /**
   * Current number of complete lines in buffer (lines with newline)
   * Partial lines without trailing newline are not counted
   */
  get lineCount(): number {
    // Count only lines that end with newline
    return this.lines.filter(line => line.endsWith('\n')).length;
  }
}
