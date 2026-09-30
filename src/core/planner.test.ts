import { describe, expect, it } from 'vitest';
import { createTypingPlan, replayPlan } from './planner';
import { DEFAULT_PROFILE, type TypingProfile, type TypoKind } from './types';

function profile(overrides: Partial<TypingProfile> = {}): TypingProfile {
  return {
    ...DEFAULT_PROFILE,
    typoKinds: { ...DEFAULT_PROFILE.typoKinds },
    ...overrides,
  };
}

function onlyTypo(kind: TypoKind): TypingProfile {
  return profile({
    typoRate: 100,
    typoKinds: {
      substitution: false,
      duplicate: false,
      transposition: false,
      omission: false,
      word: false,
      [kind]: true,
    },
  });
}

describe('createTypingPlan', () => {
  it.each([
    ['substitution', 'hello there'],
    ['duplicate', 'hello there'],
    ['transposition', 'abcdefgh'],
    ['omission', 'abcdefgh'],
    ['word', 'testing words'],
  ] as [TypoKind, string][])('corrects %s mistakes to the exact source', (kind, source) => {
    const plan = createTypingPlan(source, onlyTypo(kind), 42);
    expect(plan.steps.some((step) => step.behavior === kind)).toBe(true);
    expect(replayPlan(plan)).toBe(source);
    expect(plan.steps.reduce((sum, step) => sum + step.sourceAdvance, 0)).toBe(plan.graphemeCount);
  });

  it('is deterministic for a supplied seed', () => {
    const first = createTypingPlan('A fairly long deterministic sentence.', profile(), 12345);
    const second = createTypingPlan('A fairly long deterministic sentence.', profile(), 12345);
    expect(first).toEqual(second);
  });

  it('calibrates a long typo-free sample to target effective WPM', () => {
    const source = 'human paced typing '.repeat(80);
    const plan = createTypingPlan(source, profile({ targetWpm: 72, typoRate: 0 }), 99);
    const targetMs = (plan.graphemeCount * 12_000) / 72;
    expect(Math.abs(plan.estimatedMs - targetMs) / targetMs).toBeLessThan(0.01);
  });

  it('includes heavy correction activity in the effective WPM budget', () => {
    const source = 'correction behavior remains inside the timing budget '.repeat(40);
    const configured = onlyTypo('word');
    configured.targetWpm = 110;
    configured.typoRate = 10;
    const plan = createTypingPlan(source, configured, 731);
    const targetMs = (plan.graphemeCount * 12_000) / configured.targetWpm;
    expect(Math.abs(plan.estimatedMs - targetMs) / targetMs).toBeLessThan(0.1);
    expect(replayPlan(plan)).toBe(source);
  });

  it('gives punctuation and paragraphs longer relative pauses', () => {
    const plan = createTypingPlan('a.b\nc', profile({ typoRate: 0, randomness: 0, pauseStrength: 100 }), 1);
    const delays = plan.steps.map((step) => step.delayMs);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[3]).toBeGreaterThan(delays[0]);
  });

  it('counts joined emoji as one source grapheme and replays it exactly', () => {
    const plan = createTypingPlan('A👩‍💻B', profile({ typoRate: 0 }), 7);
    expect(plan.graphemeCount).toBe(3);
    expect(replayPlan(plan)).toBe('A👩‍💻B');
  });
});
