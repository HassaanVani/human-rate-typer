export type StartMode = 'click' | 'focused' | 'shortcut';
export type TypoKind = 'substitution' | 'duplicate' | 'transposition' | 'omission' | 'word';
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
  | { type: 'enter' };

export interface TypingStep {
  action: InputAction;
  delayMs: number;
  sourceAdvance: number;
  behavior: 'normal' | TypoKind | 'correction';
}

export interface TypingPlan {
  seed: number;
  source: string;
  graphemeCount: number;
  estimatedMs: number;
  steps: TypingStep[];
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
  | { type: 'ARM_TARGET'; source: string; profile: TypingProfile; seed: number }
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
