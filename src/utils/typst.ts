const TYPST_SPECIAL_CHARS = /[\\#*_$@<>`[\]~]/g;

/** Escapes Typst markup characters (and comment openers) in free text. */
export function escapeTypst(value: string | undefined | null): string {
  if (!value) return '';
  return String(value)
    .replace(TYPST_SPECIAL_CHARS, (ch) => `\\${ch}`)
    .replace(/\/\//g, '\\/\\/')
    .replace(/\/\*/g, '\\/*')
    .replace(/\*\//g, '*\\/')
    .trim();
}

/** Escapes a value to be embedded inside a Typst double-quoted string literal. */
export function escapeTypstStringLiteral(value: string | undefined | null): string {
  return value ? String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim() : '';
}
