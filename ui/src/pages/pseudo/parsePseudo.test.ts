import { parsePseudo, ParsedFunction, ParsedPseudo } from './parsePseudo';

describe('parsePseudo', () => {
  describe('basic structure', () => {
    it('parses title line from first // comment', () => {
      const content = '// My Parser\n';
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('My Parser');
    });

    it('parses subtitle line from second // comment', () => {
      const content = '// My Parser\n// Parse pseudo code files\n';
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('My Parser');
      expect(result.subtitleLine).toBe('Parse pseudo code files');
    });

    it('extracts module prose (non-// lines before first FUNCTION)', () => {
      const content = `// Title
// Subtitle
Module description line 1
Module description line 2

FUNCTION foo() -> string
body line
---`;
      const result = parsePseudo(content);
      expect(result.moduleProse).toEqual([
        'Module description line 1',
        'Module description line 2',
        ''
      ]);
    });

    it('handles empty module prose', () => {
      const content = `// Title
// Subtitle

FUNCTION foo() -> string
body
---`;
      const result = parsePseudo(content);
      expect(result.moduleProse).toEqual(['']);
    });

    it('stops collecting prose at first FUNCTION line', () => {
      const content = `// Title
Line 1
Line 2
FUNCTION test()
---`;
      const result = parsePseudo(content);
      expect(result.moduleProse).toContain('Line 1');
      expect(result.moduleProse).toContain('Line 2');
      expect(result.functions.length).toBe(1);
    });
  });

  describe('FUNCTION parsing', () => {
    it('parses minimal function with just name', () => {
      const content = `FUNCTION test
---`;
      const result = parsePseudo(content);
      expect(result.functions).toHaveLength(1);
      const fn = result.functions[0];
      expect(fn.name).toBe('test');
      expect(fn.params).toBe('');
      expect(fn.returnType).toBe('');
      expect(fn.isExport).toBe(false);
    });

    it('parses function with parameters', () => {
      const content = `FUNCTION test(x: number, y: string)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.name).toBe('test');
      expect(fn.params).toBe('x: number, y: string');
    });

    it('parses function with return type', () => {
      const content = `FUNCTION test() -> string
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.returnType).toBe('string');
    });

    it('parses function with parameters and return type', () => {
      const content = `FUNCTION test(x: number) -> boolean
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.name).toBe('test');
      expect(fn.params).toBe('x: number');
      expect(fn.returnType).toBe('boolean');
    });

    it('parses EXPORT marker', () => {
      const content = `FUNCTION test() EXPORT
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].isExport).toBe(true);
    });

    it('parses function with all parts: params, return type, and EXPORT', () => {
      const content = `FUNCTION parseData(input: string) -> Data EXPORT
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.name).toBe('parseData');
      expect(fn.params).toBe('input: string');
      expect(fn.returnType).toBe('Data');
      expect(fn.isExport).toBe(true);
    });

    it('accepts dots in function names', () => {
      const content = `FUNCTION Math.sqrt() -> number
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].name).toBe('Math.sqrt');
    });

    it('allows variable whitespace around FUNCTION', () => {
      const content = `FUNCTION   test   (  )   ->   string
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.name).toBe('test');
      expect(fn.returnType).toBe('string');
    });
  });

  describe('function body parsing', () => {
    it('captures body lines until --- separator', () => {
      const content = `FUNCTION test()
line 1
line 2
line 3
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].body).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('handles empty function body', () => {
      const content = `FUNCTION test()
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].body).toEqual([]);
    });

    it('captures body with blank lines', () => {
      const content = `FUNCTION test()
line 1

line 3
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].body).toEqual(['line 1', '', 'line 3']);
    });
  });

  describe('CALLS parsing', () => {
    it('parses single call on CALLS: line', () => {
      const content = `FUNCTION test()
CALLS: parseData (input)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls).toHaveLength(1);
      expect(fn.calls[0]).toEqual({ name: 'parseData', fileStem: 'input' });
    });

    it('parses multiple calls on same CALLS: line', () => {
      const content = `FUNCTION test()
CALLS: getData (x), process (y)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls).toHaveLength(2);
      expect(fn.calls[0]).toEqual({ name: 'getData', fileStem: 'x' });
      expect(fn.calls[1]).toEqual({ name: 'process', fileStem: 'y' });
    });

    it('extracts fileStem from complex argument', () => {
      const content = `FUNCTION test()
CALLS: getData (file.json)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls[0]).toEqual({ name: 'getData', fileStem: 'file.json' });
    });

    it('handles multiple calls in CALLS annotation', () => {
      const content = `FUNCTION test()
CALLS: foo (x), bar (y), baz (z)
do some work
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls).toHaveLength(3);
      expect(fn.calls[0].name).toBe('foo');
      expect(fn.calls[1].name).toBe('bar');
      expect(fn.calls[2].name).toBe('baz');
    });

    it('ignores non-CALLS: body lines that contain function-like syntax', () => {
      const content = `FUNCTION test()
CALLS: getData (input)
comment about this function
x = 10
result = process(value)
another comment
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls).toHaveLength(1);
      expect(fn.calls[0].name).toBe('getData');
    });

    it('parses calls with underscores in names', () => {
      const content = `FUNCTION test()
CALLS: get_data (file_name)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls[0]).toEqual({ name: 'get_data', fileStem: 'file_name' });
    });

    it('parses calls with dots in names', () => {
      const content = `FUNCTION test()
CALLS: Math.sqrt (value)
---`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.calls[0]).toEqual({ name: 'Math.sqrt', fileStem: 'value' });
    });
  });

  describe('multiple functions', () => {
    it('parses multiple functions in sequence', () => {
      const content = `// Title
FUNCTION first()
body1
---
FUNCTION second()
body2
---`;
      const result = parsePseudo(content);
      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe('first');
      expect(result.functions[1].name).toBe('second');
    });

    it('maintains separate calls for each function', () => {
      const content = `FUNCTION first()
CALLS: foo (x)
---
FUNCTION second()
CALLS: bar (y)
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].calls).toEqual([{ name: 'foo', fileStem: 'x' }]);
      expect(result.functions[1].calls).toEqual([{ name: 'bar', fileStem: 'y' }]);
    });

    it('handles functions with different parameter and return type configurations', () => {
      const content = `FUNCTION first()
---
FUNCTION second(a: int, b: string) -> bool EXPORT
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].params).toBe('');
      expect(result.functions[1].params).toBe('a: int, b: string');
      expect(result.functions[1].returnType).toBe('bool');
      expect(result.functions[1].isExport).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles file with no header lines', () => {
      const content = `FUNCTION test()
---`;
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('');
      expect(result.subtitleLine).toBe('');
    });

    it('handles file with only title, no subtitle', () => {
      const content = `// Title
FUNCTION test()
---`;
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('Title');
      expect(result.subtitleLine).toBe('');
    });

    it('handles file ending without --- separator', () => {
      const content = `FUNCTION test()
body line 1
body line 2`;
      const result = parsePseudo(content);
      const fn = result.functions[0];
      expect(fn.body).toEqual(['body line 1', 'body line 2']);
    });

    it('handles module-only file (no FUNCTION blocks)', () => {
      const content = `// Title
// Subtitle
This is module prose only.
No functions defined here.`;
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('Title');
      expect(result.subtitleLine).toBe('Subtitle');
      expect(result.moduleProse).toContain('This is module prose only.');
      expect(result.moduleProse).toContain('No functions defined here.');
      expect(result.functions).toEqual([]);
    });

    it('handles empty file', () => {
      const content = '';
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('');
      expect(result.subtitleLine).toBe('');
      expect(result.moduleProse).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    it('handles minimal file (header + 1 function)', () => {
      const content = `// My Parser
FUNCTION parse()
---`;
      const result = parsePseudo(content);
      expect(result.titleLine).toBe('My Parser');
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('parse');
    });

    it('preserves whitespace in body lines', () => {
      const content = `FUNCTION test()
  indented line
    more indented
not indented
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].body).toEqual([
        '  indented line',
        '    more indented',
        'not indented'
      ]);
    });

    it('handles comment-style lines in function body', () => {
      const content = `FUNCTION test()
CALLS: foo (x)
// this is a comment in the body
---`;
      const result = parsePseudo(content);
      expect(result.functions[0].body).toContain('// this is a comment in the body');
      expect(result.functions[0].calls).toEqual([{ name: 'foo', fileStem: 'x' }]);
    });
  });

  describe('real-world examples', () => {
    it('parses a complete pseudo file', () => {
      const content = `// Data Parser
// Extract structured data from files

FUNCTION readFile(path: string) -> Content EXPORT
open file at path
read bytes
return content
---

FUNCTION parseJSON(text: string) -> Data
CALLS: deserialize (text), validate (data)
return result
---`;
      const result = parsePseudo(content);

      expect(result.titleLine).toBe('Data Parser');
      expect(result.subtitleLine).toBe('Extract structured data from files');
      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe('readFile');
      expect(result.functions[0].params).toBe('path: string');
      expect(result.functions[0].returnType).toBe('Content');
      expect(result.functions[0].isExport).toBe(true);
      expect(result.functions[0].body).toHaveLength(3);

      expect(result.functions[1].name).toBe('parseJSON');
      expect(result.functions[1].calls.length).toBe(2);
      expect(result.functions[1].calls[0]).toEqual({ name: 'deserialize', fileStem: 'text' });
      expect(result.functions[1].calls[1]).toEqual({ name: 'validate', fileStem: 'data' });
    });
  });
});
