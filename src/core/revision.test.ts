import { describe, expect, it } from 'vitest';
import { rescaleRemainingPlan } from './planner';
import {
  alignParagraphs,
  createRevisionPlan,
  paragraphSimilarity,
  progressiveRevision,
  replayRevisionPlan,
} from './revision';
import { DEFAULT_PROFILE, DEFAULT_REVISION_PROFILE, type RevisionProfile } from './types';

function revision(overrides: Partial<RevisionProfile> = {}): RevisionProfile {
  return { ...DEFAULT_REVISION_PROFILE, ...overrides, enabled: true };
}

describe('revision playback', () => {
  it('scores identical paragraphs above meaningfully changed paragraphs', () => {
    expect(paragraphSimilarity('The same sentence.', 'The same sentence.')).toBe(1);
    expect(paragraphSimilarity('The first draft.', 'A completely rewritten conclusion.')).toBeLessThan(0.5);
  });

  it('selects word, sentence, and paragraph strategies from similarity', () => {
    const profile = revision();
    const rows = alignParagraphs(
      'A mostly identical sentence here.\nThis draft has one central idea. It needs detail.\nTiny.',
      'A mostly identical sentence there.\nThis final has one central argument. It needs supporting detail.\nA completely rewritten and substantially longer final paragraph.',
      profile,
    );
    expect(rows.map((row) => row.granularity)).toEqual(['word', 'sentence', 'paragraph']);
  });

  it('requires an explicit one-to-one paragraph pairing', () => {
    expect(() => alignParagraphs('one\ntwo', 'one', revision())).toThrow(/same paragraph count/);
  });

  it('progressively reaches the exact final text at word and sentence granularity', () => {
    const final = 'This final sentence is clearer. It includes evidence.';
    for (const granularity of ['word', 'sentence'] as const) {
      const stages = progressiveRevision('This draft sentence is vague. It lacks evidence.', final, granularity);
      expect(stages.length).toBeGreaterThan(1);
      expect(stages.at(-1)).toBe(final);
    }
  });

  it('creates deterministic hopping and finishes with the exact final document', () => {
    const draft = 'Draft alpha text.\nDraft beta text.\nDraft gamma text.';
    const final = 'Final alpha text.\nFinal beta text.\nFinal gamma text.';
    const settings = revision({ draftHopping: 100, revisionHopping: 100 });
    const first = createRevisionPlan(draft, final, { ...DEFAULT_PROFILE, typoRate: 0 }, settings, 417);
    const second = createRevisionPlan(draft, final, { ...DEFAULT_PROFILE, typoRate: 0 }, settings, 417);
    expect(first).toEqual(second);
    expect(replayRevisionPlan(first)).toBe(final);
    const draftTargets = first.steps
      .filter((item) => item.behavior === 'draft' && item.action.type === 'revision-patch')
      .map((item) => item.action.type === 'revision-patch' ? item.action.paragraphIndex : -1);
    expect(draftTargets.some((value, index) => index > 0 && value < draftTargets[index - 1]!)).toBe(true);
  });

  it('keeps reflection pauses fixed when live WPM changes', () => {
    const plan = createRevisionPlan(
      'First draft.\nSecond draft.',
      'First final.\nSecond final.',
      DEFAULT_PROFILE,
      revision({ paragraphPauseMinMs: 5_000, paragraphPauseMaxMs: 5_000 }),
      44,
    );
    const before = plan.steps.map((item) => item.delayMs);
    rescaleRemainingPlan(plan, 0, 50, 100);
    plan.steps.forEach((item, index) => {
      if (item.behavior === 'reflection') expect(item.delayMs).toBe(before[index]);
    });
  });
});
