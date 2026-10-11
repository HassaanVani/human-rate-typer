export type StartMode = 'click' | 'focused' | 'shortcut';
export type TypoKind = 'substitution' | 'duplicate' | 'transposition' | 'omission' | 'word';
export type RevisionGranularity = 'auto' | 'word' | 'sentence' | 'paragraph';
export type SessionStatus =
  | 'idle'
  | 'arming'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

export interface TypingProfile {
  targetWpm: number;
  randomness: number;
  pauseStrength: number;
  typoRate: number;
  typoKinds: Record<TypoKind, boolean>;
  correctionDelayMs: number;
  countdownSeconds: number;
  startMode: StartMode;
}

export interface RevisionProfile {
  enabled: boolean;
  draftHopping: number;
  revisionHopping: number;
  paragraphPauseMinMs: number;
  paragraphPauseMaxMs: number;
  granularity: RevisionGranularity;
  wordSimilarityThreshold: number;
  sentenceSimilarityThreshold: number;
}

export interface CleanupRemoval {
  codePoint: string;
  name: string;
  count: number;
  indices: number[];
}

export interface CleanupNormalization extends CleanupRemoval {
  replacement: string;
}

export interface CleanupResult {
  original: string;
  cleaned: string;
  removals: CleanupRemoval[];
  normalizations: CleanupNormalization[];
  normalizedLineEndings: number;
}

export type InputAction =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'enter' }
  | { type: 'revision-reset'; paragraphCount: number }
  | { type: 'revision-patch'; paragraphIndex: number; text: string }
  | { type: 'wait' };

export interface TypingStep {
  action: InputAction;
  delayMs: number;
  sourceAdvance: number;
  behavior: 'normal' | TypoKind | 'correction' | 'draft' | 'revision' | 'reflection';
  lockedDelay?: boolean;
}

export interface TypingPlan {
  seed: number;
  source: string;
  graphemeCount: number;
  estimatedMs: number;
  steps: TypingStep[];
  mode?: 'standard' | 'revision';
}

export interface TypingSession {
  id: string;
  tabId: number | null;
  status: SessionStatus;
  cursor: number;
  completedGraphemes: number;
  startedAt: number | null;
  elapsedBeforePauseMs: number;
  error?: string;
}

export type PanelToBackgroundMessage =
  | { type: 'HELLO' }
  | {
      type: 'ARM_TARGET';
      source: string;
      profile: TypingProfile;
      seed: number;
      draftSource?: string;
      revisionProfile?: RevisionProfile;
    }
  | { type: 'PREPARE_SESSION'; mode: Exclude<StartMode, 'shortcut'> }
  | { type: 'DISPATCH_INPUT'; action: InputAction }
  | { type: 'SET_WPM'; targetWpm: number }
  | { type: 'PAUSE_BACKGROUND' }
  | { type: 'RESUME_BACKGROUND' }
  | { type: 'FINISH_SESSION' }
  | { type: 'STOP_SESSION'; reason?: string };

export type BackgroundToPanelMessage =
  | { type: 'READY' }
  | { type: 'TARGET_SELECTED'; tabId: number; label: string }
  | { type: 'SESSION_READY'; tabId: number }
  | { type: 'COMMAND'; command: 'start-typing' | 'toggle-pause' | 'emergency-stop' }
  | { type: 'PAGE_POINTER' }
  | {
      type: 'BACKGROUND_STATE';
      status: Extract<SessionStatus, 'arming' | 'countdown' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'>;
      countdown: number;
      completed: number;
      total: number;
      remainingMs: number;
      elapsedMs: number;
      targetWpm: number;
      error?: string;
    }
  | { type: 'SESSION_ABORTED'; reason: string }
  | { type: 'ERROR'; message: string };

export const DEFAULT_PROFILE: TypingProfile = {
  targetWpm: 55,
  randomness: 45,
  pauseStrength: 50,
  typoRate: 1.5,
  typoKinds: {
    substitution: true,
    duplicate: true,
    transposition: true,
    omission: true,
    word: true,
  },
  correctionDelayMs: 380,
  countdownSeconds: 3,
  startMode: 'click',
};

export const DEFAULT_REVISION_PROFILE: RevisionProfile = {
  enabled: false,
  draftHopping: 45,
  revisionHopping: 70,
  paragraphPauseMinMs: 4_000,
  paragraphPauseMaxMs: 12_000,
  granularity: 'auto',
  wordSimilarityThreshold: 0.82,
  sentenceSimilarityThreshold: 0.55,
};
