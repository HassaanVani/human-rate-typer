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

  it('normalizes all supported line endings without trimming', () => {
    const result = cleanText('  a\r\nb\rc\u2028d\u2029e  ');
    expect(result.cleaned).toBe('  a\nb\nc\nd\ne  ');
    expect(result.normalizedLineEndings).toBe(4);
  });

  it('preserves multilingual text, emoji joins, variation selectors, tabs, and typography', () => {
    const source = 'العربية\u200C हिन्दी 👩‍💻 ❤️\t“café”—日本語';
    const result = cleanText(source);
    expect(result.cleaned).toBe(source);
    expect(result.removals).toEqual([]);
  });

  it('formats supplementary code points', () => {
    expect(formatCodePoint(0xe0001)).toBe('U+E0001');
  });
});
