import type { CleanupNormalization, CleanupRemoval, CleanupResult } from './types';

const NAMED_CONTROLS = new Map<number, string>([
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
  [0x061c, 'ARABIC LETTER MARK'],
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

const NORMALIZED_CHARACTERS = new Map<number, { name: string; replacement: string }>([
  [0x00a0, { name: 'NO-BREAK SPACE', replacement: ' ' }],
  [0x1680, { name: 'OGHAM SPACE MARK', replacement: ' ' }],
  [0x180e, { name: 'MONGOLIAN VOWEL SEPARATOR', replacement: ' ' }],
  [0x2000, { name: 'EN QUAD', replacement: ' ' }],
  [0x2001, { name: 'EM QUAD', replacement: ' ' }],
  [0x2002, { name: 'EN SPACE', replacement: ' ' }],
  [0x2003, { name: 'EM SPACE', replacement: ' ' }],
  [0x2004, { name: 'THREE-PER-EM SPACE', replacement: ' ' }],
  [0x2005, { name: 'FOUR-PER-EM SPACE', replacement: ' ' }],
  [0x2006, { name: 'SIX-PER-EM SPACE', replacement: ' ' }],
  [0x2007, { name: 'FIGURE SPACE', replacement: ' ' }],
  [0x2008, { name: 'PUNCTUATION SPACE', replacement: ' ' }],
  [0x2009, { name: 'THIN SPACE', replacement: ' ' }],
  [0x200a, { name: 'HAIR SPACE', replacement: ' ' }],
  [0x202f, { name: 'NARROW NO-BREAK SPACE', replacement: ' ' }],
  [0x205f, { name: 'MEDIUM MATHEMATICAL SPACE', replacement: ' ' }],
  [0x3000, { name: 'IDEOGRAPHIC SPACE', replacement: ' ' }],

  [0x2018, { name: 'LEFT SINGLE QUOTATION MARK', replacement: "'" }],
  [0x2019, { name: 'RIGHT SINGLE QUOTATION MARK', replacement: "'" }],
  [0x201a, { name: 'SINGLE LOW-9 QUOTATION MARK', replacement: "'" }],
  [0x201b, { name: 'SINGLE HIGH-REVERSED-9 QUOTATION MARK', replacement: "'" }],
  [0x02bc, { name: 'MODIFIER LETTER APOSTROPHE', replacement: "'" }],
  [0x2032, { name: 'PRIME', replacement: "'" }],
  [0x2035, { name: 'REVERSED PRIME', replacement: "'" }],
  [0xff07, { name: 'FULLWIDTH APOSTROPHE', replacement: "'" }],

  [0x201c, { name: 'LEFT DOUBLE QUOTATION MARK', replacement: '"' }],
  [0x201d, { name: 'RIGHT DOUBLE QUOTATION MARK', replacement: '"' }],
  [0x201e, { name: 'DOUBLE LOW-9 QUOTATION MARK', replacement: '"' }],
  [0x201f, { name: 'DOUBLE HIGH-REVERSED-9 QUOTATION MARK', replacement: '"' }],
  [0x2033, { name: 'DOUBLE PRIME', replacement: '"' }],
  [0x2036, { name: 'REVERSED DOUBLE PRIME', replacement: '"' }],
  [0xff02, { name: 'FULLWIDTH QUOTATION MARK', replacement: '"' }],

  [0x2010, { name: 'HYPHEN', replacement: '-' }],
  [0x2011, { name: 'NON-BREAKING HYPHEN', replacement: '-' }],
  [0x2012, { name: 'FIGURE DASH', replacement: '-' }],
  [0x2013, { name: 'EN DASH', replacement: '-' }],
  [0x2014, { name: 'EM DASH', replacement: '-' }],
  [0x2015, { name: 'HORIZONTAL BAR', replacement: '-' }],
  [0xfe58, { name: 'SMALL EM DASH', replacement: '-' }],
  [0xfe63, { name: 'SMALL HYPHEN-MINUS', replacement: '-' }],
  [0xff0d, { name: 'FULLWIDTH HYPHEN-MINUS', replacement: '-' }],
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
  const lineEndingMatches = original.match(/\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g) ?? [];
  const normalized = original.replace(/\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g, '\n');
  const removals = new Map<number, CleanupRemoval>();
  const normalizations = new Map<number, CleanupNormalization>();
  const kept: string[] = [];
  let index = 0;

  for (const character of normalized) {
    const codePoint = character.codePointAt(0)!;
    const name = removableName(codePoint);
    const normalization = NORMALIZED_CHARACTERS.get(codePoint);
    if (normalization) {
      const current = normalizations.get(codePoint) ?? {
        codePoint: formatCodePoint(codePoint),
        name: normalization.name,
        replacement: normalization.replacement,
        count: 0,
        indices: [],
      };
      current.count += 1;
      current.indices.push(index);
      normalizations.set(codePoint, current);
      kept.push(normalization.replacement);
    } else if (name) {
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
    normalizations: [...normalizations.values()],
    normalizedLineEndings: lineEndingMatches.length,
  };
}
