import { describe, expect, it } from 'vitest';
import { keyboardEventForAscii } from './keymap';

describe('keyboardEventForAscii', () => {
  it('maps citation punctuation to real physical keys', () => {
    expect(keyboardEventForAscii('.')).toEqual({ code: 'Period', virtualKeyCode: 190, modifiers: 0 });
    expect(keyboardEventForAscii('(')).toEqual({ code: 'Digit9', virtualKeyCode: 57, modifiers: 8 });
    expect(keyboardEventForAscii(')')).toEqual({ code: 'Digit0', virtualKeyCode: 48, modifiers: 8 });
    expect(keyboardEventForAscii(':')).toEqual({ code: 'Semicolon', virtualKeyCode: 186, modifiers: 8 });
    expect(keyboardEventForAscii('"')).toEqual({ code: 'Quote', virtualKeyCode: 222, modifiers: 8 });
  });

  it('maps every printable ASCII character', () => {
    for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
      expect(keyboardEventForAscii(String.fromCharCode(codePoint)), `U+${codePoint.toString(16)}`).not.toBeNull();
    }
  });

  it('leaves Unicode graphemes for Input.insertText', () => {
    expect(keyboardEventForAscii('é')).toBeNull();
    expect(keyboardEventForAscii('👩‍💻')).toBeNull();
  });
});
