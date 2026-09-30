import type { CleanupRemoval, CleanupResult } from './types';

const NAMED_CONTROLS = new Map<number, string>([
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2060, 'WORD JOINER'],
  [0x2061, 'FUNCTION APPLICATION'],
  [0x2062, 'INVISIBLE TIMES'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0x2064, 'INVISIBLE PLUS'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE / BOM'],
]);

function removableName(codePoint: number): string | null {
  const named = NAMED_CONTROLS.get(codePoint);
  if (named) return named;
  if (codePoint >= 0x206a && codePoint <= 0x206f) return 'DEPRECATED BIDI FORMAT CONTROL';
  if (codePoint >= 0xfff9 && codePoint <= 0xfffb) return 'INTERLINEAR ANNOTATION CONTROL';
  if (codePoint >= 0x1bca0 && codePoint <= 0x1bca3) return 'SHORTHAND FORMAT CONTROL';
  if (codePoint >= 0x1d173 && codePoint <= 0x1d17a) return 'MUSICAL SYMBOL FORMAT CONTROL';
  if (codePoint === 0xe0000 || codePoint === 0xe0001 || (codePoint >= 0xe0020 && codePoint <= 0xe007f)) {
    return 'UNICODE TAG CHARACTER';
  }
  return null;
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function cleanText(original: string): CleanupResult {
  const lineEndingMatches = original.match(/\r\n?|\u2028|\u2029/g) ?? [];
  const normalized = original.replace(/\r\n?|\u2028|\u2029/g, '\n');
  const removals = new Map<number, CleanupRemoval>();
  const kept: string[] = [];
  let index = 0;

  for (const character of normalized) {
    const codePoint = character.codePointAt(0)!;
    const name = removableName(codePoint);
    if (name) {
      const current = removals.get(codePoint) ?? {
        codePoint: formatCodePoint(codePoint),
        name,
        count: 0,
        indices: [],
      };
      current.count += 1;
      current.indices.push(index);
      removals.set(codePoint, current);
    } else {
      kept.push(character);
    }
    index += character.length;
  }

  return {
    original,
    cleaned: kept.join(''),
    removals: [...removals.values()],
    normalizedLineEndings: lineEndingMatches.length,
  };
}
