export interface KeyMetadata {
  code: string;
  virtualKeyCode: number;
  modifiers: number;
}

const SHIFT = 8;

const PUNCTUATION: Record<string, KeyMetadata> = {
  '`': { code: 'Backquote', virtualKeyCode: 192, modifiers: 0 },
  '~': { code: 'Backquote', virtualKeyCode: 192, modifiers: SHIFT },
  '-': { code: 'Minus', virtualKeyCode: 189, modifiers: 0 },
  '_': { code: 'Minus', virtualKeyCode: 189, modifiers: SHIFT },
  '=': { code: 'Equal', virtualKeyCode: 187, modifiers: 0 },
  '+': { code: 'Equal', virtualKeyCode: 187, modifiers: SHIFT },
  '[': { code: 'BracketLeft', virtualKeyCode: 219, modifiers: 0 },
  '{': { code: 'BracketLeft', virtualKeyCode: 219, modifiers: SHIFT },
  ']': { code: 'BracketRight', virtualKeyCode: 221, modifiers: 0 },
  '}': { code: 'BracketRight', virtualKeyCode: 221, modifiers: SHIFT },
  '\\': { code: 'Backslash', virtualKeyCode: 220, modifiers: 0 },
  '|': { code: 'Backslash', virtualKeyCode: 220, modifiers: SHIFT },
  ';': { code: 'Semicolon', virtualKeyCode: 186, modifiers: 0 },
  ':': { code: 'Semicolon', virtualKeyCode: 186, modifiers: SHIFT },
  "'": { code: 'Quote', virtualKeyCode: 222, modifiers: 0 },
  '"': { code: 'Quote', virtualKeyCode: 222, modifiers: SHIFT },
  ',': { code: 'Comma', virtualKeyCode: 188, modifiers: 0 },
  '<': { code: 'Comma', virtualKeyCode: 188, modifiers: SHIFT },
  '.': { code: 'Period', virtualKeyCode: 190, modifiers: 0 },
  '>': { code: 'Period', virtualKeyCode: 190, modifiers: SHIFT },
  '/': { code: 'Slash', virtualKeyCode: 191, modifiers: 0 },
  '?': { code: 'Slash', virtualKeyCode: 191, modifiers: SHIFT },
  ' ': { code: 'Space', virtualKeyCode: 32, modifiers: 0 },
};

const SHIFTED_DIGITS = ')!@#$%^&*(';

export function keyboardEventForAscii(text: string): KeyMetadata | null {
  if (text.length !== 1 || !/^[\x20-\x7e]$/.test(text)) return null;
  if (/^[a-zA-Z]$/.test(text)) {
    const upper = text.toUpperCase();
    return {
      code: `Key${upper}`,
      virtualKeyCode: upper.charCodeAt(0),
      modifiers: text === upper ? SHIFT : 0,
    };
  }
  if (/^[0-9]$/.test(text)) {
    return { code: `Digit${text}`, virtualKeyCode: text.charCodeAt(0), modifiers: 0 };
  }
  const shiftedDigit = SHIFTED_DIGITS.indexOf(text);
  if (shiftedDigit >= 0) {
    const digit = String(shiftedDigit);
    return { code: `Digit${digit}`, virtualKeyCode: digit.charCodeAt(0), modifiers: SHIFT };
  }
  return PUNCTUATION[text] ?? null;
}
