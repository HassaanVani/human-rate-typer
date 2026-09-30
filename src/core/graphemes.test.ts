import { expect, it } from 'vitest';
import { splitGraphemes } from './graphemes';

it('segments user-perceived Unicode graphemes', () => {
  expect(splitGraphemes('A👩‍💻e\u0301🇨🇦')).toEqual(['A', '👩‍💻', 'e\u0301', '🇨🇦']);
});
