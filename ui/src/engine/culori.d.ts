declare module 'culori' {
  export function parse(input: string): { alpha?: number; [key: string]: unknown } | undefined
  export function formatHex(color: { mode: string; r: number; g: number; b: number }): string | undefined
  export function converter(mode: string): (color: unknown) => { r?: number; g?: number; b?: number } | undefined
}
