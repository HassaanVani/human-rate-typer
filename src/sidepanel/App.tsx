import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanText } from '../core/cleanup';
import { createTypingPlan, rescaleRemainingPlan } from '../core/planner';
import { createSeed } from '../core/random';
import {
  DEFAULT_PROFILE,
  type BackgroundToPanelMessage,
  type PanelToBackgroundMessage,
  type SessionStatus,
  type StartMode,
  type TypingPlan,
  type TypingProfile,
  type TypoKind,
} from '../core/types';

const TYPO_LABELS: Record<TypoKind, string> = {
  substitution: 'Adjacent key',
  duplicate: 'Double letter',
  transposition: 'Transpose',
  omission: 'Omit & repair',
  word: 'Word repair',
};

function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

function statusText(status: SessionStatus): string {
  const labels: Record<SessionStatus, string> = {
    idle: 'Ready', arming: 'Waiting for target', countdown: 'Starting soon', running: 'Typing',
    paused: 'Paused', completed: 'Complete', stopped: 'Stopped', error: 'Needs attention',
  };
  return labels[status];
}

export function App() {
  const [text, setText] = useState('');
  const [profile, setProfile] = useState<TypingProfile>(DEFAULT_PROFILE);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<'input' | 'preview'>('input');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState('');
  const [backgroundOwned, setBackgroundOwned] = useState(false);
  const [backgroundTotal, setBackgroundTotal] = useState(0);
  const [backgroundRemainingMs, setBackgroundRemainingMs] = useState(0);

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const planRef = useRef<TypingPlan | null>(null);
  const statusRef = useRef<SessionStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dueAtRef = useRef(0);
  const remainingDelayRef = useRef<number | null>(null);
  const stepIndexRef = useRef(0);
  const completedRef = useRef(0);
  const activeStartedAtRef = useRef<number | null>(null);
  const elapsedBeforeRunRef = useRef(0);
  const backgroundOwnedRef = useRef(false);
  const profileRef = useRef(profile);
  const activeWpmRef = useRef(profile.targetWpm);
  profileRef.current = profile;
  const cleanup = useMemo(() => cleanText(text), [text]);
  const handlersRef = useRef<{
    begin: (mode?: StartMode) => void;
    beginCountdown: () => void;
    pause: (reason?: string) => void;
    resume: () => void;
    stop: (reason?: string, nextStatus?: SessionStatus) => void;
  } | null>(null);

  const setSessionStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const post = useCallback((message: PanelToBackgroundMessage) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      setError('The extension background service is unavailable. Reopen the side panel.');
      setSessionStatus('error');
    }
  }, [setSessionStatus]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearTimeout(countdownRef.current);
    timerRef.current = null;
    countdownRef.current = null;
  }, []);

  const recordElapsed = useCallback(() => {
    if (activeStartedAtRef.current !== null) {
      elapsedBeforeRunRef.current += performance.now() - activeStartedAtRef.current;
      activeStartedAtRef.current = null;
    }
    setElapsedMs(elapsedBeforeRunRef.current);
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    recordElapsed();
    setSessionStatus('completed');
    backgroundOwnedRef.current = false;
    setBackgroundOwned(false);
    post({ type: 'FINISH_SESSION' });
  }, [clearTimers, post, recordElapsed, setSessionStatus]);

  const scheduleNextRef = useRef<() => void>(() => undefined);
  scheduleNextRef.current = () => {
    const plan = planRef.current;
    if (!plan || statusRef.current !== 'running') return;
    const index = stepIndexRef.current;
    if (index >= plan.steps.length) {
      finish();
      return;
    }
    const step = plan.steps[index]!;
    const delay = remainingDelayRef.current ?? step.delayMs;
    remainingDelayRef.current = null;
    dueAtRef.current = performance.now() + delay;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (statusRef.current !== 'running') return;
      post({ type: 'DISPATCH_INPUT', action: step.action });
      stepIndexRef.current += 1;
      completedRef.current += step.sourceAdvance;
      setStepIndex(stepIndexRef.current);
      setCompleted(completedRef.current);
      scheduleNextRef.current();
    }, delay);
  };

  const startPlan = useCallback(() => {
    const currentProfile = profileRef.current;
    const plan = createTypingPlan(cleanup.cleaned, currentProfile, createSeed());
    planRef.current = plan;
    activeWpmRef.current = currentProfile.targetWpm;
    stepIndexRef.current = 0;
    completedRef.current = 0;
    elapsedBeforeRunRef.current = 0;
    remainingDelayRef.current = null;
    activeStartedAtRef.current = performance.now();
    setCompleted(0);
    setStepIndex(0);
    setElapsedMs(0);
    setSessionStatus('running');
    scheduleNextRef.current();
  }, [cleanup.cleaned, setSessionStatus]);

  const beginCountdown = useCallback(() => {
    let remaining = Math.max(0, Math.round(profileRef.current.countdownSeconds));
    setCountdown(remaining);
    setSessionStatus('countdown');
    const tick = () => {
      if (statusRef.current !== 'countdown') return;
      if (remaining <= 0) {
        setCountdown(0);
        startPlan();
        return;
      }
      setCountdown(remaining);
      remaining -= 1;
      countdownRef.current = setTimeout(tick, 1000);
    };
    tick();
  }, [setSessionStatus, startPlan]);

  const stop = useCallback((reason?: string, nextStatus: SessionStatus = 'stopped') => {
    clearTimers();
    recordElapsed();
    remainingDelayRef.current = null;
    setSessionStatus(nextStatus);
    if (reason) setError(reason);
    post({ type: 'STOP_SESSION', reason });
  }, [clearTimers, post, recordElapsed, setSessionStatus]);

  const pause = useCallback((reason?: string) => {
    if (statusRef.current !== 'running') return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingDelayRef.current = Math.max(0, dueAtRef.current - performance.now());
    recordElapsed();
    setSessionStatus('paused');
    if (reason) setError(reason);
  }, [recordElapsed, setSessionStatus]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    setError('');
    activeStartedAtRef.current = performance.now();
    setSessionStatus('running');
    window.setTimeout(() => scheduleNextRef.current(), 0);
  }, [setSessionStatus]);

  const begin = useCallback((mode: StartMode = profile.startMode) => {
    if (!cleanup.cleaned) {
      setError('Paste some text before starting.');
      setSessionStatus('error');
      return;
    }
    if (['running', 'paused', 'countdown', 'arming'].includes(statusRef.current)) stop();
    setError('');
    setTargetLabel('');
    if (mode === 'click') {
      activeWpmRef.current = profile.targetWpm;
      backgroundOwnedRef.current = true;
      setBackgroundOwned(true);
      setSessionStatus('arming');
      post({ type: 'ARM_TARGET', source: cleanup.cleaned, profile, seed: createSeed() });
    } else {
      backgroundOwnedRef.current = false;
      setBackgroundOwned(false);
      setSessionStatus('countdown');
      post({ type: 'PREPARE_SESSION', mode: 'focused' });
    }
  }, [cleanup.cleaned, post, profile.startMode, setSessionStatus, stop]);

  handlersRef.current = { begin, beginCountdown, pause, resume, stop };

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'human-rate-typer' });
    portRef.current = port;
    const onMessage = (message: BackgroundToPanelMessage) => {
      switch (message.type) {
        case 'TARGET_SELECTED':
          setTargetLabel(message.label);
          break;
        case 'SESSION_READY':
          handlersRef.current?.beginCountdown();
          break;
        case 'COMMAND':
          if (message.command === 'start-typing') handlersRef.current?.begin('shortcut');
          if (message.command === 'toggle-pause') {
            if (statusRef.current === 'paused') handlersRef.current?.resume(); else handlersRef.current?.pause();
          }
          if (message.command === 'emergency-stop') handlersRef.current?.stop('Stopped with the emergency shortcut.');
          break;
        case 'PAGE_POINTER':
          handlersRef.current?.pause('Paused because you clicked elsewhere on the page.');
          break;
        case 'BACKGROUND_STATE':
          backgroundOwnedRef.current = true;
          setBackgroundOwned(true);
          setSessionStatus(message.status);
          setCountdown(message.countdown);
          setCompleted(message.completed);
          setBackgroundTotal(message.total);
          setBackgroundRemainingMs(message.remainingMs);
          setElapsedMs(message.elapsedMs);
          activeWpmRef.current = message.targetWpm;
          setProfile((current) => current.targetWpm === message.targetWpm
            ? current
            : { ...current, targetWpm: message.targetWpm });
          if (message.error) setError(message.error);
          else if (message.status === 'running') setError('');
          break;
        case 'SESSION_ABORTED':
          handlersRef.current?.stop(message.reason, 'error');
          break;
        case 'ERROR':
          handlersRef.current?.stop(message.message, 'error');
          break;
      }
    };
    port.onMessage.addListener(onMessage);
    post({ type: 'HELLO' });
    return () => {
      clearTimers();
      if (!backgroundOwnedRef.current) {
        try { port.postMessage({ type: 'STOP_SESSION', reason: 'Side panel closed.' }); } catch { /* closed */ }
      }
      port.disconnect();
      portRef.current = null;
    };
  }, [clearTimers, post, setSessionStatus]);

  useEffect(() => {
    void Promise.all([
      chrome.storage.session.get(['draftText', 'pendingCommand']),
      chrome.storage.local.get(['profile']),
    ]).then(([sessionData, localData]) => {
      if (typeof sessionData.draftText === 'string') setText(sessionData.draftText);
      if (localData.profile) {
        const storedProfile = { ...DEFAULT_PROFILE, ...localData.profile };
        setProfile(storedProfile);
        profileRef.current = storedProfile;
        activeWpmRef.current = storedProfile.targetWpm;
      }
      if (typeof sessionData.pendingCommand === 'string') setPendingCommand(sessionData.pendingCommand);
      void chrome.storage.session.remove('pendingCommand');
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => void chrome.storage.session.set({ draftText: text }), 250);
    return () => clearTimeout(handle);
  }, [loaded, text]);

  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => void chrome.storage.local.set({ profile }), 250);
    return () => clearTimeout(handle);
  }, [loaded, profile]);

  useEffect(() => {
    if (!loaded || !pendingCommand) return;
    const command = pendingCommand;
    setPendingCommand(null);
    const handle = setTimeout(() => {
      if (command === 'start-typing') begin('shortcut');
      if (command === 'emergency-stop') stop('Stopped with the emergency shortcut.');
    }, 150);
    return () => clearTimeout(handle);
  }, [begin, loaded, pendingCommand, stop]);

  useEffect(() => {
    if (status !== 'running') return;
    const ticker = setInterval(() => {
      setNowTick((value) => value + 1);
      const active = activeStartedAtRef.current === null ? 0 : performance.now() - activeStartedAtRef.current;
      setElapsedMs(elapsedBeforeRunRef.current + active);
    }, 250);
    return () => clearInterval(ticker);
  }, [status]);

  useEffect(() => {
    void chrome.storage.session.set({
      activeSession: {
        status,
        completed,
        total: planRef.current?.graphemeCount ?? 0,
        updatedAt: Date.now(),
      },
    });
  }, [completed, status]);

  const previewPlan = useMemo(
    () => createTypingPlan(cleanup.cleaned, profile, 0x485254),
    [cleanup.cleaned, profile],
  );
  const total = backgroundOwned ? backgroundTotal : (planRef.current?.graphemeCount ?? previewPlan.graphemeCount);
  const progress = total ? Math.min(100, (completed / total) * 100) : 0;
  const remainingMs = backgroundOwned ? backgroundRemainingMs : planRef.current
    ? planRef.current.steps.slice(stepIndex).reduce((sum, step) => sum + step.delayMs, 0)
    : previewPlan.estimatedMs;
  const effectiveWpm = elapsedMs > 1000 ? ((completed / 5) / (elapsedMs / 60_000)) : 0;
  void nowTick;

  const updateProfile = <K extends keyof TypingProfile>(key: K, value: TypingProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const updateTargetWpm = (targetWpm: number) => {
    const nextWpm = Math.min(200, Math.max(10, targetWpm));
    const previousWpm = activeWpmRef.current;
    setProfile((current) => ({ ...current, targetWpm: nextWpm }));
    profileRef.current = { ...profileRef.current, targetWpm: nextWpm };
    activeWpmRef.current = nextWpm;
    if (!['arming', 'countdown', 'running', 'paused'].includes(statusRef.current)) return;
    if (backgroundOwnedRef.current) {
      post({ type: 'SET_WPM', targetWpm: nextWpm });
      return;
    }
    const plan = planRef.current;
    if (!plan || previousWpm === nextWpm) return;
    const ratio = rescaleRemainingPlan(plan, stepIndexRef.current, previousWpm, nextWpm);
    const running = statusRef.current === 'running';
    const currentRemaining = running
      ? Math.max(0, dueAtRef.current - performance.now())
      : remainingDelayRef.current;
    if (running && timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (currentRemaining !== null) remainingDelayRef.current = currentRemaining * ratio;
    setNowTick((value) => value + 1);
    if (running) window.setTimeout(() => scheduleNextRef.current(), 0);
  };

  const toggleTypo = (kind: TypoKind) => {
    setProfile((current) => ({
      ...current,
      typoKinds: { ...current.typoKinds, [kind]: !current.typoKinds[kind] },
    }));
  };

  const busy = ['arming', 'countdown', 'running', 'paused'].includes(status);

  return (
    <main className="app-shell">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <h1>Human Rate Typer</h1>
          <p>Local, paced input for the web</p>
        </div>
        <span className={`status-pill status-${status}`}><i />{statusText(status)}</span>
      </header>

      <section className="card composer-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">01 · TEXT</span>
            <h2>What should be typed?</h2>
          </div>
          <div className="tab-switcher" role="tablist">
            <button className={activeView === 'input' ? 'active' : ''} onClick={() => setActiveView('input')}>Input</button>
            <button className={activeView === 'preview' ? 'active' : ''} onClick={() => setActiveView('preview')}>Clean preview</button>
          </div>
        </div>

        {activeView === 'input' ? (
          <textarea
            className="text-editor"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste or type a large amount of text here…"
            spellCheck={false}
            disabled={busy}
          />
        ) : (
          <pre className="clean-preview">{cleanup.cleaned || 'Your cleaned text will appear here.'}</pre>
        )}

        <div className="text-meta">
          <span>{cleanup.cleaned.length.toLocaleString()} characters</span>
          <span>≈ {duration(previewPlan.estimatedMs)}</span>
          <span className={cleanup.removals.length ? 'cleaning-found' : 'cleaning-clear'}>
            {cleanup.removals.reduce((sum, item) => sum + item.count, 0)} hidden removed
          </span>
        </div>

        {(cleanup.removals.length > 0 || cleanup.normalizedLineEndings > 0) && (
          <details className="cleanup-report">
            <summary>Cleanup report</summary>
            <div>
              {cleanup.normalizedLineEndings > 0 && <p>Normalized {cleanup.normalizedLineEndings} line ending(s).</p>}
              {cleanup.removals.map((item) => (
                <p key={item.codePoint}><code>{item.codePoint}</code> {item.name} <strong>×{item.count}</strong></p>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div><span className="eyebrow">02 · RHYTHM</span><h2>Set the pace</h2></div>
          <output className="wpm-output">{profile.targetWpm}<small> WPM</small></output>
        </div>

        <label className="slider-row">
          <span>Average speed {busy && <b>Live</b>}</span>
          <input type="range" min="10" max="200" value={profile.targetWpm}
            onChange={(event) => updateTargetWpm(Number(event.target.value))} />
          <span className="range-labels"><i>10</i><i>200</i></span>
        </label>

        <div className="two-column-controls">
          <label className="slider-row compact">
            <span>Speed variation <b>{profile.randomness}%</b></span>
            <input type="range" min="0" max="100" value={profile.randomness} disabled={busy}
              onChange={(event) => updateProfile('randomness', Number(event.target.value))} />
          </label>
          <label className="slider-row compact">
            <span>Natural pauses <b>{profile.pauseStrength}%</b></span>
            <input type="range" min="0" max="100" value={profile.pauseStrength} disabled={busy}
              onChange={(event) => updateProfile('pauseStrength', Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="card">
        <button className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced}>
          <span><span className="eyebrow">03 · BEHAVIOR</span><strong>Mistakes & corrections</strong></span>
          <span>{profile.typoRate.toFixed(1)} / 100 chars {showAdvanced ? '−' : '+'}</span>
        </button>
        {showAdvanced && (
          <div className="advanced-body">
            <label className="slider-row compact">
              <span>Typo frequency <b>{profile.typoRate.toFixed(1)}</b></span>
              <input type="range" min="0" max="10" step="0.5" value={profile.typoRate} disabled={busy}
                onChange={(event) => updateProfile('typoRate', Number(event.target.value))} />
            </label>
            <label className="slider-row compact">
              <span>Notice & correct delay <b>{profile.correctionDelayMs} ms</b></span>
              <input type="range" min="100" max="1200" step="20" value={profile.correctionDelayMs} disabled={busy}
                onChange={(event) => updateProfile('correctionDelayMs', Number(event.target.value))} />
            </label>
            <div className="chip-grid">
              {(Object.keys(TYPO_LABELS) as TypoKind[]).map((kind) => (
                <button key={kind} className={profile.typoKinds[kind] ? 'chip selected' : 'chip'}
                  disabled={busy} onClick={() => toggleTypo(kind)}>
                  <span>{profile.typoKinds[kind] ? '✓' : ''}</span>{TYPO_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card launch-card">
        <div className="section-heading">
          <div><span className="eyebrow">04 · DESTINATION</span><h2>Choose how to start</h2></div>
        </div>
        <div className="mode-grid">
          {([
            ['click', 'Click target', 'Arm, then click an editor'],
            ['focused', 'Focused field', 'Use the last focused editor'],
            ['shortcut', 'Shortcut', '⌘/Ctrl + Shift + Y'],
          ] as [StartMode, string, string][]).map(([mode, title, description]) => (
            <button key={mode} className={profile.startMode === mode ? 'mode selected' : 'mode'}
              disabled={busy} onClick={() => updateProfile('startMode', mode)}>
              <span className="radio-dot" /><strong>{title}</strong><small>{description}</small>
            </button>
          ))}
        </div>
        <label className="countdown-control">
          <span>Start countdown</span>
          <select value={profile.countdownSeconds} disabled={busy}
            onChange={(event) => updateProfile('countdownSeconds', Number(event.target.value))}>
            <option value="0">None</option><option value="1">1 second</option><option value="3">3 seconds</option><option value="5">5 seconds</option>
          </select>
        </label>
      </section>

      {busy && (
        <section className="session-card" aria-live="polite">
          <div className="session-topline">
            <span>{status === 'arming' ? 'Click the destination field on the page' : status === 'countdown' ? `Starting in ${countdown}…` : statusText(status)}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          {targetLabel && <p className="target-label">Target: {targetLabel}</p>}
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="session-stats">
            <span><b>{completed.toLocaleString()}</b> / {total.toLocaleString()} chars</span>
            <span><b>{effectiveWpm ? effectiveWpm.toFixed(0) : '—'}</b> WPM</span>
            <span><b>{duration(remainingMs)}</b> left</span>
          </div>
          <div className="session-actions">
            {status === 'running' && <button className="secondary-button" onClick={() => backgroundOwned ? post({ type: 'PAUSE_BACKGROUND' }) : pause()}>Pause</button>}
            {status === 'paused' && <button className="secondary-button" onClick={() => backgroundOwned ? post({ type: 'RESUME_BACKGROUND' }) : resume()}>Resume</button>}
            <button className="stop-button" onClick={() => stop()}>Stop</button>
          </div>
        </section>
      )}

      {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}

      {!busy && (
        <button className="primary-button" onClick={() => begin()} disabled={!cleanup.cleaned}>
          <span className="play-icon">▶</span>
          {status === 'completed' || status === 'stopped' ? 'Start again' : 'Start typing'}
          <span className="button-hint">{duration(previewPlan.estimatedMs)}</span>
        </button>
      )}

      <footer>
        <span>Text stays on this device</span>
        <span>Emergency stop: <kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd></span>
      </footer>
    </main>
  );
}
