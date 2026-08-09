/**
 * Subject function that is never invoked by its test.
 * This demonstrates the "never-called" mutation-probe shape:
 * mutations to this function's body would not be caught by the associated test.
 */
export function neverCalledSubject(input: string): string {
  // Real computation: reverse the input string
  return input.split('').reverse().join('');
}
