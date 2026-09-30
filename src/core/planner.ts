import { splitGraphemes } from './graphemes';
import { SeededRandom } from './random';
import type { TypingPlan, TypingProfile, TypingStep, TypoKind } from './types';

const ADJACENT: Record<string, string> = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'ersfcx', e: 'wsdr', f: 'rtgdvc', g: 'tyfhvb',
  h: 'yugjbn', i: 'ujko', j: 'uikhmn', k: 'ijolm', l: 'kop', m: 'njk', n: 'bhjm',
  o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'wedxza', t: 'rfgy', u: 'yhji',
  v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx',
};

function insertion(text: string, behavior: TypingStep['behavior'], sourceAdvance = 0): TypingStep {
  return {
    action: text === '\n' ? { type: 'enter' } : { type: 'insert', text },
    delayMs: 1,
    sourceAdvance,
    behavior,
  };
}

function backspace(behavior: TypingStep['behavior'] = 'correction'): TypingStep {
  return { action: { type: 'backspace' }, delayMs: 1, sourceAdvance: 0, behavior };
}

function isSimpleLetter(value: string): boolean {
  return /^[A-Za-z]$/.test(value);
}

function wrongNeighbor(value: string, random: SeededRandom): string {
  const lower = value.toLowerCase();
  const neighbor = random.pick((ADJACENT[lower] ?? 'etaoin').split(''));
  return value === value.toUpperCase() ? neighbor.toUpperCase() : neighbor;
}

function enabledKinds(profile: TypingProfile): TypoKind[] {
  return (Object.keys(profile.typoKinds) as TypoKind[]).filter((kind) => profile.typoKinds[kind]);
}

function appendNormal(steps: TypingStep[], value: string, advance = 1): void {
  steps.push(insertion(value, 'normal', advance));
}

function appendTypo(
  steps: TypingStep[],
  graphemes: string[],
  index: number,
  kind: TypoKind,
  random: SeededRandom,
): number {
  const current = graphemes[index]!;
  if (kind === 'substitution' && isSimpleLetter(current)) {
    steps.push(insertion(wrongNeighbor(current, random), kind), backspace(), insertion(current, 'correction', 1));
    return 1;
  }
  if (kind === 'duplicate') {
    steps.push(insertion(current, kind, 1), insertion(current, kind), backspace());
    return 1;
  }
  if (kind === 'transposition' && index + 1 < graphemes.length) {
    const next = graphemes[index + 1]!;
    if (!/\s/.test(current + next)) {
      steps.push(
        insertion(next, kind), insertion(current, kind), backspace(), backspace(),
        insertion(current, 'correction', 1), insertion(next, 'correction', 1),
      );
      return 2;
    }
  }
  if (kind === 'omission' && index + 1 < graphemes.length && !/\s/.test(current)) {
    const following = graphemes.slice(index + 1, Math.min(index + 3, graphemes.length));
    if (following.length && following.every((value) => !/\s/.test(value))) {
      following.forEach((value) => steps.push(insertion(value, kind)));
      following.forEach(() => steps.push(backspace()));
      steps.push(insertion(current, 'correction', 1));
      following.forEach((value) => steps.push(insertion(value, 'correction', 1)));
      return 1 + following.length;
    }
  }
  if (kind === 'word' && isSimpleLetter(current)) {
    let end = index;
    while (end < graphemes.length && isSimpleLetter(graphemes[end]!) && end - index < 12) end += 1;
    const word = graphemes.slice(index, end);
    if (word.length >= 3) {
      steps.push(insertion(wrongNeighbor(word[0]!, random), kind));
      word.slice(1).forEach((value) => steps.push(insertion(value, kind)));
      word.forEach(() => steps.push(backspace()));
      word.forEach((value) => steps.push(insertion(value, 'correction', 1)));
      return word.length;
    }
  }
  appendNormal(steps, current);
  return 1;
}

function punctuationWeight(step: TypingStep, strength: number): number {
  if (step.action.type === 'enter') return 4.5 * strength;
  if (step.action.type !== 'insert') return 0;
  if (/[.!?]/.test(step.action.text)) return 3.1 * strength;
  if (/[,;:]/.test(step.action.text)) return 1.7 * strength;
  return 0;
}

export function createTypingPlan(source: string, profile: TypingProfile, seed: number): TypingPlan {
  const graphemes = splitGraphemes(source);
  const random = new SeededRandom(seed);
  const kinds = enabledKinds(profile);
  const steps: TypingStep[] = [];
  let index = 0;

  while (index < graphemes.length) {
    const canTypo = kinds.length > 0 && !/\s/.test(graphemes[index]!);
    if (canTypo && random.next() < profile.typoRate / 100) {
      index += appendTypo(steps, graphemes, index, random.pick(kinds), random);
    } else {
      appendNormal(steps, graphemes[index]!);
      index += 1;
    }
  }

  const targetMs = graphemes.length === 0 ? 0 : (graphemes.length * 12_000) / profile.targetWpm;
  const variability = profile.randomness / 100;
  const pauseStrength = profile.pauseStrength / 100;
  const rawWeights = steps.map((step) => {
    const jitter = Math.exp((random.next() - 0.5) * variability * 1.8);
    const correction = step.behavior === 'correction' ? profile.correctionDelayMs / 100 : 0;
    const thinking = random.next() < 0.008 * pauseStrength ? random.between(3, 10) * pauseStrength : 0;
    return Math.max(0.1, jitter + punctuationWeight(step, pauseStrength) + correction + thinking);
  });
  const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0) || 1;
  const minimumDelay = profile.targetWpm >= 180 ? 6 : 10;
  steps.forEach((step, stepIndex) => {
    step.delayMs = Math.max(minimumDelay, (rawWeights[stepIndex]! / weightTotal) * targetMs);
  });

  return {
    seed,
    source,
    graphemeCount: graphemes.length,
    estimatedMs: steps.reduce((sum, step) => sum + step.delayMs, 0),
    steps,
  };
}

export function replayPlan(plan: TypingPlan): string {
  const buffer: string[] = [];
  for (const step of plan.steps) {
    if (step.action.type === 'backspace') buffer.pop();
    else if (step.action.type === 'enter') buffer.push('\n');
    else buffer.push(step.action.text);
  }
  return buffer.join('');
}
