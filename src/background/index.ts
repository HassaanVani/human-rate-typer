import type {
  BackgroundToPanelMessage,
  InputAction,
  PanelToBackgroundMessage,
  TypingPlan,
  TypingProfile,
} from '../core/types';
import { createTypingPlan, rescaleRemainingPlan } from '../core/planner';
import { keyboardEventForAscii } from '../core/keymap';

let panelPort: chrome.runtime.Port | null = null;
let attachedTabId: number | null = null;
let armedTabId: number | null = null;
let controlTargetTabId: number | null = null;
let controlWindowId: number | null = null;
let messageChain: Promise<void> = Promise.resolve();
let intentionalDetach = false;

interface AutomatedSession {
  plan: TypingPlan;
  profile: TypingProfile;
  status: 'arming' | 'countdown' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
  stepIndex: number;
  completed: number;
  countdown: number;
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
  remainingDelay: number | null;
  elapsedMs: number;
  runningSince: number | null;
  error?: string;
}

let automatedSession: AutomatedSession | null = null;

const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
  side_panel?: { default_path: string };
  sidebar_action?: { default_panel: string };
};
const usesChromeSidePanel = Boolean(manifest.side_panel && chrome.sidePanel);
const usesOperaSidebar = Boolean(manifest.sidebar_action);
const usesPersistentPanel = usesChromeSidePanel || usesOperaSidebar;

const targetFor = (tabId: number): chrome.debugger.Debuggee => ({ tabId });

function send(message: BackgroundToPanelMessage): void {
  try {
    panelPort?.postMessage(message);
  } catch {
    panelPort = null;
  }
}

function isAllowedUrl(url?: string): boolean {
  if (!url) return false;
  return /^(https?|file):/i.test(url);
}

async function resolveTabUrl(tab: chrome.tabs.Tab): Promise<string | undefined> {
  if (tab.url) return tab.url;
  if (!tab.id) return undefined;
  try {
    const targets = await chrome.debugger.getTargets();
    return targets.find((target) => target.tabId === tab.id)?.url;
  } catch {
    return undefined;
  }
}

async function requireAllowedTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  const url = await resolveTabUrl(tab);
  if (!isAllowedUrl(url)) throw new Error('Chrome does not allow typing on this protected page.');
  return { ...tab, url };
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  if (!usesPersistentPanel && controlTargetTabId !== null) {
    try {
      const target = await chrome.tabs.get(controlTargetTabId);
      if (target.id) return await requireAllowedTab(target);
    } catch {
      controlTargetTabId = null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab was found.');
  return requireAllowedTab(tab);
}

async function openOperaController(tabId: number, pendingCommand?: string): Promise<void> {
  controlTargetTabId = tabId;
  if (pendingCommand) await chrome.storage.session.set({ pendingCommand });
  if (controlWindowId !== null) {
    try {
      await chrome.windows.update(controlWindowId, { focused: true });
      return;
    } catch {
      controlWindowId = null;
    }
  }
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('sidepanel.html'),
    type: 'popup',
    width: 440,
    height: 860,
    focused: true,
  });
  controlWindowId = created?.id ?? null;
}

async function inspectFocusedTarget(tabId: number): Promise<{ valid: boolean; password: boolean; label: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return { valid: false, password: false, label: 'No focused element' };
      const input = element instanceof HTMLInputElement ? element : null;
      const password = input?.type === 'password';
      const editableInput = Boolean(
        input &&
          !input.disabled &&
          !input.readOnly &&
          !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(input.type),
      );
      const textarea = element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly;
      const editable = element.isContentEditable || Boolean(element.closest('[contenteditable="true"]'));
      const roleTextbox = element.getAttribute('role') === 'textbox' || Boolean(element.closest('[role="textbox"]'));
      const complexEditor =
        element instanceof HTMLCanvasElement ||
        element.tagName === 'IFRAME' ||
        Boolean(document.querySelector('.kix-appview-editor, .CodeMirror, .cm-editor, .monaco-editor'));
      return {
        valid: Boolean(editableInput || textarea || editable || roleTextbox || complexEditor),
        password: Boolean(password),
        label: element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.tagName.toLowerCase(),
      };
    },
  });
  return result?.result ?? { valid: false, password: false, label: 'Unknown target' };
}

async function armTarget(): Promise<void> {
  const tab = await activeTab();
  armedTabId = tab.id!;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id!, allFrames: true },
    func: () => {
      const key = '__humanRateTyperArm';
      const state = window as typeof window & Record<string, unknown>;
      if (state[key]) return;
      state[key] = true;
      const handler = (event: PointerEvent) => {
        state[key] = false;
        const element = event.target instanceof Element ? event.target : document.activeElement;
        const input = element instanceof HTMLInputElement ? element : null;
        const password = input?.type === 'password';
        const label =
          element?.getAttribute('aria-label') ||
          element?.getAttribute('placeholder') ||
          element?.tagName.toLowerCase() ||
          'page editor';
        window.setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'HRT_TARGET_CLICKED', password, label });
        }, 0);
        document.removeEventListener('pointerdown', handler, true);
      };
      document.addEventListener('pointerdown', handler, true);
    },
  });
}

async function installPointerMonitor(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const key = '__humanRateTyperMonitor';
        const state = window as typeof window & Record<string, unknown>;
        if (state[key]) return;
        state[key] = true;
        document.addEventListener(
          'pointerdown',
          () => chrome.runtime.sendMessage({ type: 'HRT_PAGE_POINTER' }),
          true,
        );
      },
    });
  } catch {
    // Debugger input still works in editors where content scripts cannot be injected.
  }
}

async function attach(tabId: number): Promise<void> {
  if (attachedTabId === tabId) return;
  if (attachedTabId !== null) await detach();
  try {
    await chrome.debugger.attach(targetFor(tabId), '1.3');
    attachedTabId = tabId;
    await installPointerMonitor(tabId);
  } catch (error) {
    throw new Error(
      `Could not start keyboard control. Close DevTools for this tab and try again. ${error instanceof Error ? error.message : ''}`.trim(),
    );
  }
}

async function detach(): Promise<void> {
  if (attachedTabId === null) return;
  const tabId = attachedTabId;
  attachedTabId = null;
  intentionalDetach = true;
  try {
    await chrome.debugger.detach(targetFor(tabId));
  } catch {
    // The target may already be gone.
  } finally {
    intentionalDetach = false;
  }
}

async function dispatchKey(action: InputAction): Promise<void> {
  if (attachedTabId === null) throw new Error('The typing session is not attached to a tab.');
  const debuggee = targetFor(attachedTabId);
  if (action.type === 'backspace' || action.type === 'enter') {
    const key = action.type === 'backspace' ? 'Backspace' : 'Enter';
    const code = action.type === 'backspace' ? 'Backspace' : 'Enter';
    const virtualKeyCode = action.type === 'backspace' ? 8 : 13;
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
    });
    return;
  }

  const metadata = keyboardEventForAscii(action.text);
  if (metadata) {
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: action.text,
      code: metadata.code,
      text: action.text,
      unmodifiedText: action.text,
      modifiers: metadata.modifiers,
      windowsVirtualKeyCode: metadata.virtualKeyCode,
      nativeVirtualKeyCode: metadata.virtualKeyCode,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: action.text, code: metadata.code,
      modifiers: metadata.modifiers, windowsVirtualKeyCode: metadata.virtualKeyCode,
    });
  } else {
    await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: action.text });
  }
}

function automationIsActive(): boolean {
  return Boolean(automatedSession && ['arming', 'countdown', 'running', 'paused'].includes(automatedSession.status));
}

function automationElapsed(session: AutomatedSession): number {
  return session.elapsedMs + (session.runningSince === null ? 0 : Date.now() - session.runningSince);
}

function automationRemaining(session: AutomatedSession): number {
  if (session.status === 'completed') return 0;
  const future = session.plan.steps
    .slice(session.stepIndex + 1)
    .reduce((sum, step) => sum + step.delayMs, 0);
  const scheduled = Math.max(0, session.dueAt - Date.now()) ||
    session.plan.steps[session.stepIndex]?.delayMs || 0;
  const current = session.remainingDelay ?? scheduled;
  return current + future;
}

function emitAutomationState(): void {
  const session = automatedSession;
  if (!session) return;
  const message: BackgroundToPanelMessage = {
    type: 'BACKGROUND_STATE',
    status: session.status,
    countdown: session.countdown,
    completed: session.completed,
    total: session.plan.graphemeCount,
    remainingMs: automationRemaining(session),
    elapsedMs: automationElapsed(session),
    targetWpm: session.profile.targetWpm,
    error: session.error,
  };
  send(message);
  void chrome.storage.session.set({ activeSession: { ...message, updatedAt: Date.now() } });
}

function clearAutomationTimer(): void {
  if (automatedSession?.timer) clearTimeout(automatedSession.timer);
  if (automatedSession) automatedSession.timer = null;
}

function recordAutomationElapsed(): void {
  if (!automatedSession || automatedSession.runningSince === null) return;
  automatedSession.elapsedMs += Date.now() - automatedSession.runningSince;
  automatedSession.runningSince = null;
}

async function stopAutomation(
  status: AutomatedSession['status'] = 'stopped',
  error?: string,
): Promise<void> {
  if (!automatedSession) {
    await detach();
    return;
  }
  clearAutomationTimer();
  recordAutomationElapsed();
  automatedSession.status = status;
  automatedSession.error = error;
  automatedSession.remainingDelay = null;
  await detach();
  armedTabId = null;
  void chrome.storage.session.remove('pendingClickSession');
  emitAutomationState();
}

function pauseAutomation(reason?: string): void {
  const session = automatedSession;
  if (!session || session.status !== 'running') return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  session.remainingDelay = Math.max(0, session.dueAt - Date.now());
  recordAutomationElapsed();
  session.status = 'paused';
  session.error = reason;
  emitAutomationState();
}

function scheduleAutomationStep(): void {
  const session = automatedSession;
  if (!session || session.status !== 'running') return;
  if (session.stepIndex >= session.plan.steps.length) {
    void stopAutomation('completed');
    return;
  }
  const step = session.plan.steps[session.stepIndex]!;
  const delay = session.remainingDelay ?? step.delayMs;
  session.remainingDelay = null;
  session.dueAt = Date.now() + delay;
  session.timer = setTimeout(() => {
    session.timer = null;
    void dispatchKey(step.action)
      .then(() => {
        if (automatedSession !== session || session.status !== 'running') return;
        session.stepIndex += 1;
        session.completed += step.sourceAdvance;
        emitAutomationState();
        scheduleAutomationStep();
      })
      .catch((error) => void stopAutomation('error', error instanceof Error ? error.message : String(error)));
  }, delay);
}

function resumeAutomation(): void {
  const session = automatedSession;
  if (!session || session.status !== 'paused') return;
  session.status = 'running';
  session.error = undefined;
  session.runningSince = Date.now();
  emitAutomationState();
  scheduleAutomationStep();
}

function setAutomationWpm(targetWpm: number): void {
  const session = automatedSession;
  if (!session) return;
  const nextWpm = Math.min(200, Math.max(10, targetWpm));
  const previousWpm = session.profile.targetWpm;
  if (nextWpm === previousWpm) return;
  const ratio = rescaleRemainingPlan(session.plan, session.stepIndex, previousWpm, nextWpm);
  const wasRunning = session.status === 'running';
  const currentRemaining = wasRunning
    ? Math.max(0, session.dueAt - Date.now())
    : session.remainingDelay;
  if (wasRunning && session.timer) clearTimeout(session.timer);
  session.timer = null;
  session.profile = { ...session.profile, targetWpm: nextWpm };
  if (currentRemaining !== null) session.remainingDelay = currentRemaining * ratio;
  void chrome.storage.session.set({
    pendingClickSession: {
      source: session.plan.source,
      profile: session.profile,
      seed: session.plan.seed,
    },
  });
  emitAutomationState();
  if (wasRunning) scheduleAutomationStep();
}

function startAutomationTyping(): void {
  const session = automatedSession;
  if (!session) return;
  session.status = 'running';
  session.countdown = 0;
  session.runningSince = Date.now();
  emitAutomationState();
  scheduleAutomationStep();
}

function startAutomationCountdown(): void {
  const session = automatedSession;
  if (!session) return;
  session.status = 'countdown';
  session.countdown = Math.max(0, Math.round(session.profile.countdownSeconds));
  emitAutomationState();
  const tick = () => {
    if (automatedSession !== session || session.status !== 'countdown') return;
    if (session.countdown <= 0) {
      startAutomationTyping();
      return;
    }
    session.countdown -= 1;
    emitAutomationState();
    session.timer = setTimeout(tick, 1000);
  };
  session.timer = setTimeout(tick, session.countdown > 0 ? 1000 : 0);
}

async function prepareAutomatedTarget(tabId: number, label: string): Promise<void> {
  const session = automatedSession;
  if (!session || session.status !== 'arming') return;
  const target = await inspectFocusedTarget(tabId);
  if (target.password) throw new Error('Typing into password fields is blocked.');
  if (!target.valid) throw new Error('Click directly inside a text editor, then try again.');
  await attach(tabId);
  send({ type: 'TARGET_SELECTED', tabId, label });
  startAutomationCountdown();
}

async function restorePendingAutomation(): Promise<void> {
  if (automatedSession) return;
  const stored = await chrome.storage.session.get('pendingClickSession');
  const pending = stored.pendingClickSession as
    | { source: string; profile: TypingProfile; seed: number }
    | undefined;
  if (!pending) return;
  automatedSession = {
    plan: createTypingPlan(pending.source, pending.profile, pending.seed),
    profile: pending.profile,
    status: 'arming',
    stepIndex: 0,
    completed: 0,
    countdown: pending.profile.countdownSeconds,
    timer: null,
    dueAt: 0,
    remainingDelay: null,
    elapsedMs: 0,
    runningSince: null,
  };
}

async function beginAutomatedClickSession(
  source: string,
  profile: TypingProfile,
  seed: number,
): Promise<void> {
  if (automationIsActive()) await stopAutomation('stopped');
  automatedSession = {
    plan: createTypingPlan(source, profile, seed),
    profile,
    status: 'arming',
    stepIndex: 0,
    completed: 0,
    countdown: profile.countdownSeconds,
    timer: null,
    dueAt: 0,
    remainingDelay: null,
    elapsedMs: 0,
    runningSince: null,
  };
  await chrome.storage.session.set({ pendingClickSession: { source, profile, seed } });
  emitAutomationState();
  await armTarget();
}

async function prepareSession(mode: 'click' | 'focused'): Promise<void> {
  const tab = mode === 'click' && armedTabId !== null
    ? await chrome.tabs.get(armedTabId)
    : await activeTab();
  const allowedTab = await requireAllowedTab(tab);
  if (!allowedTab.id) throw new Error('This page cannot receive extension input.');
  const target = await inspectFocusedTarget(allowedTab.id);
  if (target.password) throw new Error('Typing into password fields is blocked.');
  if (!target.valid) throw new Error('Focus a text editor on the page, then try again.');
  await attach(allowedTab.id);
  send({ type: 'SESSION_READY', tabId: allowedTab.id });
}

async function handlePanelMessage(message: PanelToBackgroundMessage): Promise<void> {
  switch (message.type) {
    case 'HELLO':
      send({ type: 'READY' });
      await restorePendingAutomation();
      emitAutomationState();
      break;
    case 'ARM_TARGET':
      await beginAutomatedClickSession(message.source, message.profile, message.seed);
      break;
    case 'PREPARE_SESSION':
      await prepareSession(message.mode);
      break;
    case 'DISPATCH_INPUT':
      await dispatchKey(message.action);
      break;
    case 'SET_WPM':
      setAutomationWpm(message.targetWpm);
      break;
    case 'PAUSE_BACKGROUND':
      pauseAutomation();
      break;
    case 'RESUME_BACKGROUND':
      resumeAutomation();
      break;
    case 'FINISH_SESSION':
      await detach();
      armedTabId = null;
      break;
    case 'STOP_SESSION':
      if (automationIsActive()) await stopAutomation('stopped', message.reason);
      else {
        await detach();
        armedTabId = null;
      }
      break;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  if (usesChromeSidePanel) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!usesPersistentPanel && tab.id) void openOperaController(tab.id);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'human-rate-typer') return;
  panelPort = port;
  port.onMessage.addListener((message: PanelToBackgroundMessage) => {
    messageChain = messageChain
      .catch(() => undefined)
      .then(() => handlePanelMessage(message))
      .catch((error) => {
        send({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
        return detach();
      });
  });
  port.onDisconnect.addListener(() => {
    if (panelPort === port) panelPort = null;
    if (!automationIsActive()) void detach();
  });
});

chrome.runtime.onMessage.addListener((message: { type?: string; password?: boolean; label?: string }, sender) => {
  if (message.type === 'HRT_TARGET_CLICKED' && sender.tab?.id === armedTabId) {
    if (message.password) void stopAutomation('error', 'Typing into password fields is blocked.');
    else {
      messageChain = messageChain
        .catch(() => undefined)
        .then(async () => {
          await restorePendingAutomation();
          await prepareAutomatedTarget(sender.tab!.id!, message.label || 'page editor');
        })
        .catch((error) => stopAutomation('error', error instanceof Error ? error.message : String(error)));
    }
  }
  if (message.type === 'HRT_PAGE_POINTER' && sender.tab?.id === attachedTabId) {
    if (automatedSession?.status === 'running') pauseAutomation('Paused because you clicked elsewhere on the page.');
    else send({ type: 'PAGE_POINTER' });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!['start-typing', 'toggle-pause', 'emergency-stop'].includes(command)) return;
  if (command === 'emergency-stop') {
    if (automationIsActive()) void stopAutomation('stopped', 'Stopped with the emergency shortcut.');
    else void detach();
  }
  if (command === 'toggle-pause' && automationIsActive()) {
    if (automatedSession?.status === 'paused') resumeAutomation(); else pauseAutomation();
    return;
  }
  if (!usesPersistentPanel && tab?.id) controlTargetTabId = tab.id;
  if (panelPort) {
    send({ type: 'COMMAND', command: command as 'start-typing' | 'toggle-pause' | 'emergency-stop' });
    return;
  }
  void chrome.storage.session.set({ pendingCommand: command }).then(async () => {
    const active = tab?.id ? tab : await activeTab();
    if (!active.id) return;
    if (usesChromeSidePanel && active.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: active.windowId });
    } else if (!usesOperaSidebar) {
      await openOperaController(active.id, command);
    }
  }).catch(() => undefined);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === controlWindowId) {
    controlWindowId = null;
    controlTargetTabId = null;
    if (!automationIsActive()) void detach();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (attachedTabId !== null && tabId !== attachedTabId) {
    // Opera reports moving focus between browser windows as a tab activation.
    // CDP input remains explicitly bound to attachedTabId, so continuing cannot
    // redirect text into the newly focused tab.
    if (usesOperaSidebar) return;
    const reason = 'Typing stopped because the active tab changed.';
    if (automationIsActive()) void stopAutomation('error', reason);
    else {
      send({ type: 'SESSION_ABORTED', reason });
      void detach();
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (attachedTabId === tabId && changeInfo.status === 'loading') {
    const reason = 'Typing stopped because the page navigated.';
    if (automationIsActive()) void stopAutomation('error', reason);
    else {
      send({ type: 'SESSION_ABORTED', reason });
      void detach();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabId === tabId) {
    const reason = 'Typing stopped because the target tab closed.';
    if (automationIsActive()) void stopAutomation('error', reason);
    else {
      send({ type: 'SESSION_ABORTED', reason });
      void detach();
    }
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== attachedTabId || intentionalDetach) return;
  attachedTabId = null;
  const message = `Chrome ended keyboard control (${reason}).`;
  if (automationIsActive() && automatedSession) {
    clearAutomationTimer();
    recordAutomationElapsed();
    automatedSession.status = 'error';
    automatedSession.error = message;
    emitAutomationState();
  } else {
    send({ type: 'SESSION_ABORTED', reason: message });
  }
});
