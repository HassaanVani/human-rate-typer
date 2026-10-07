import { describe, expect, it } from 'vitest';
import { cleanText, formatCodePoint } from './cleanup';

describe('cleanText', () => {
  it('removes named invisible controls and reports counts', () => {
    const result = cleanText(`a\u200Bb\u200Bc\u00ADd\u2060e\uFEFFf`);
    expect(result.cleaned).toBe('abcdef');
    expect(result.removals).toEqual(expect.arrayContaining([
      expect.objectContaining({ codePoint: 'U+200B', count: 2, name: 'ZERO WIDTH SPACE' }),
      expect.objectContaining({ codePoint: 'U+00AD', count: 1 }),
      expect.objectContaining({ codePoint: 'U+2060', count: 1 }),
      expect.objectContaining({ codePoint: 'U+FEFF', count: 1 }),
    ]));
  });

  it('covers bidi, annotation, shorthand, music, and tag control ranges', () => {
    const controls = [0x202e, 0x2067, 0x206f, 0xfff9, 0x1bca0, 0x1d173, 0xe0001, 0xe0041]
      .map((value) => String.fromCodePoint(value))
      .join('');
    const result = cleanText(`left${controls}right`);
    expect(result.cleaned).toBe('leftright');
    expect(result.removals).toHaveLength(8);
  });

  it('normalizes Unicode and legacy line endings without trimming', () => {
    const result = cleanText('  a\r\nb\rc\vd\fe\u0085f\u2028g\u2029h  ');
    expect(result.cleaned).toBe('  a\nb\nc\nd\ne\nf\ng\nh  ');
    expect(result.normalizedLineEndings).toBe(7);
  });

  it('normalizes every supported Unicode space to an ASCII space', () => {
    const spaces = [
      0x00a0, 0x1680, 0x180e, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
      0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000,
    ].map((codePoint) => String.fromCodePoint(codePoint)).join('');
    const result = cleanText(`a${spaces}b`);
    expect(result.cleaned).toBe(`a${' '.repeat(17)}b`);
    expect(result.normalizations).toHaveLength(17);
    expect(result.normalizations.every((item) => item.replacement === ' ')).toBe(true);
  });

  it('normalizes compatibility quotes, apostrophes, and dashes to ASCII', () => {
    const result = cleanText('“quoted” ‘word’ ʼprime′ ″double″ – — ‑ －');
    expect(result.cleaned).toBe('"quoted" \'word\' \'prime\' "double" - - - -');
    expect(result.normalizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ codePoint: 'U+201C', replacement: '"' }),
      expect.objectContaining({ codePoint: 'U+2019', replacement: "'" }),
      expect.objectContaining({ codePoint: 'U+2013', replacement: '-' }),
    ]));
  });

  it('preserves multilingual text, emoji joins, variation selectors, and tabs', () => {
    const source = 'العربية\u200C हिन्दी 👩‍💻 ❤️\t日本語';
    const result = cleanText(source);
    expect(result.cleaned).toBe(source);
    expect(result.removals).toEqual([]);
    expect(result.normalizations).toEqual([]);
  });

  it('formats supplementary code points', () => {
    expect(formatCodePoint(0xe0001)).toBe('U+E0001');
  });
});
