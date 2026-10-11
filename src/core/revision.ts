import { splitGraphemes } from './graphemes';
import { SeededRandom } from './random';
import type {
  RevisionGranularity,
  RevisionProfile,
  TypingPlan,
  TypingProfile,
  TypingStep,
} from './types';

export interface ParagraphAlignment {
  index: number;
  draft: string;
  final: string;
  similarity: number;
  granularity: Exclude<RevisionGranularity, 'auto'>;
}

export function splitParagraphs(text: string): string[] {
  return text.split('\n');
}

function comparableTokens(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function levenshtein(first: string[], second: string[]): number {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (first[row - 1] === second[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[second.length] ?? 0;
}

export function paragraphSimilarity(draft: string, final: string): number {
  const first = comparableTokens(draft);
  const second = comparableTokens(final);
  const size = Math.max(first.length, second.length);
  if (size === 0) return 1;
  return 1 - levenshtein(first, second) / size;
}

export function revisionGranularity(
  similarity: number,
  profile: RevisionProfile,
): Exclude<RevisionGranularity, 'auto'> {
  if (profile.granularity !== 'auto') return profile.granularity;
  if (similarity >= profile.wordSimilarityThreshold) return 'word';
  if (similarity >= profile.sentenceSimilarityThreshold) return 'sentence';
  return 'paragraph';
}

export function alignParagraphs(
  draftSource: string,
  finalSource: string,
  profile: RevisionProfile,
): ParagraphAlignment[] {
  const draft = splitParagraphs(draftSource);
  const final = splitParagraphs(finalSource);
  if (draft.length !== final.length) {
    throw new Error(`Draft and final versions must have the same paragraph count (${draft.length} vs ${final.length}).`);
  }
  return final.map((finalParagraph, index) => {
    const draftParagraph = draft[index] ?? '';
    const similarity = paragraphSimilarity(draftParagraph, finalParagraph);
    return {
      index,
      draft: draftParagraph,
      final: finalParagraph,
      similarity,
      granularity: revisionGranularity(similarity, profile),
    };
  });
}

function chunks(text: string, granularity: 'word' | 'sentence'): string[] {
  if (granularity === 'sentence') {
    return text.match(/[^.!?]+(?:[.!?]+(?:\s+|$)|$)/g) ?? (text ? [text] : []);
  }
  return text.match(/\S+\s*|\s+/g) ?? (text ? [text] : []);
}

export function progressiveRevision(
  draft: string,
  final: string,
  granularity: Exclude<RevisionGranularity, 'auto'>,
): string[] {
  if (draft === final) return [];
  if (granularity === 'paragraph') return [final];
  const before = chunks(draft, granularity);
  const after = chunks(final, granularity);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  const middleEnd = suffix > 0 ? -suffix : undefined;
  const beforeMiddle = before.slice(prefix, middleEnd);
  const afterMiddle = after.slice(prefix, middleEnd);
  const stablePrefix = after.slice(0, prefix);
  const stableSuffix = after.slice(after.length - suffix);
  const count = Math.max(beforeMiddle.length, afterMiddle.length);
  const stages: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const next = [
      ...stablePrefix,
      ...afterMiddle.slice(0, Math.min(index, afterMiddle.length)),
      ...beforeMiddle.slice(Math.min(index, beforeMiddle.length)),
      ...stableSuffix,
    ].join('');
    if (stages.at(-1) !== next) stages.push(next);
  }
  if (stages.at(-1) !== final) stages.push(final);
  return stages;
}

function shuffle(values: number[], random: SeededRandom, strength: number): number[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    if (random.next() > strength / 100) continue;
    const other = Math.floor(random.next() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function step(
  action: TypingStep['action'],
  delayMs: number,
  behavior: TypingStep['behavior'],
  sourceAdvance = 0,
  lockedDelay = false,
): TypingStep {
  return { action, delayMs: Math.max(1, delayMs), sourceAdvance, behavior, lockedDelay };
}

function tokenDelay(text: string, profile: TypingProfile, random: SeededRandom): number {
  const base = Math.max(1, splitGraphemes(text).length) * 12_000 / profile.targetWpm;
  const variability = profile.randomness / 100;
  return Math.max(40, base * Math.exp((random.next() - 0.5) * variability * 1.4));
}

function reflectionDelay(profile: RevisionProfile, random: SeededRandom): number {
  const min = Math.max(0, Math.min(profile.paragraphPauseMinMs, profile.paragraphPauseMaxMs));
  const max = Math.max(min, profile.paragraphPauseMinMs, profile.paragraphPauseMaxMs);
  return random.between(min, max);
}

export function createRevisionPlan(
  draftSource: string,
  finalSource: string,
  typingProfile: TypingProfile,
  revisionProfile: RevisionProfile,
  seed: number,
): TypingPlan {
  const alignment = alignParagraphs(draftSource, finalSource, revisionProfile);
  const random = new SeededRandom(seed);
  const steps: TypingStep[] = [step(
    { type: 'revision-reset', paragraphCount: alignment.length },
    1,
    'draft',
  )];
  const buffers = alignment.map(() => '');
  const pending = alignment.map((item) => chunks(item.draft, 'word'));
  const unfinished = () => pending.flatMap((tokens, index) => tokens.length ? [index] : []);
  let active = unfinished()[0] ?? 0;

  while (unfinished().length) {
    const available = unfinished();
    if (!available.includes(active) || (available.length > 1 && random.next() < revisionProfile.draftHopping / 100)) {
      active = random.pick(available);
    }
    const token = pending[active]!.shift()!;
    buffers[active] += token;
    steps.push(step(
      { type: 'revision-patch', paragraphIndex: active, text: buffers[active]! },
      tokenDelay(token, typingProfile, random),
      'draft',
    ));
    if (pending[active]!.length === 0) {
      steps.push(step({ type: 'wait' }, reflectionDelay(revisionProfile, random), 'reflection', 0, true));
      active = unfinished()[0] ?? active;
    }
  }

  const revisionOrder = shuffle(alignment.map((item) => item.index), random, revisionProfile.revisionHopping);
  for (const paragraphIndex of revisionOrder) {
    const item = alignment[paragraphIndex]!;
    const stages = progressiveRevision(item.draft, item.final, item.granularity);
    if (!stages.length) {
      const advance = splitGraphemes(item.final).length + (paragraphIndex < alignment.length - 1 ? 1 : 0);
      steps.push(step({ type: 'wait' }, 1, 'revision', advance));
      continue;
    }
    steps.push(step({ type: 'wait' }, reflectionDelay(revisionProfile, random), 'reflection', 0, true));
    stages.forEach((text, stageIndex) => {
      const finalStage = stageIndex === stages.length - 1;
      const advance = finalStage
        ? splitGraphemes(item.final).length + (paragraphIndex < alignment.length - 1 ? 1 : 0)
        : 0;
      steps.push(step(
        { type: 'revision-patch', paragraphIndex, text },
        finalStage ? typingProfile.correctionDelayMs : tokenDelay(text, typingProfile, random) * 0.12,
        'revision',
        advance,
      ));
    });
  }

  return {
    seed,
    source: finalSource,
    graphemeCount: splitGraphemes(finalSource).length,
    estimatedMs: steps.reduce((sum, item) => sum + item.delayMs, 0),
    steps,
    mode: 'revision',
  };
}

export function replayRevisionPlan(plan: TypingPlan): string {
  let paragraphs: string[] = [];
  for (const item of plan.steps) {
    if (item.action.type === 'revision-reset') paragraphs = Array.from({ length: item.action.paragraphCount }, () => '');
    if (item.action.type === 'revision-patch') paragraphs[item.action.paragraphIndex] = item.action.text;
  }
  return paragraphs.join('\n');
}
