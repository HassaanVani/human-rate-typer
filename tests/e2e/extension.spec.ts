import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PROFILE, DEFAULT_REVISION_PROFILE } from '../../src/core/types';
import { createRevisionPlan } from '../../src/core/revision';

let context: BrowserContext;

test.beforeAll(async () => {
  const extensionPath = resolve(process.env.EXTENSION_PATH ?? 'dist');
  const userDataDir = await mkdtemp(join(tmpdir(), 'human-rate-typer-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('loads the extension and exposes editor fixtures', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  expect(worker.url()).toMatch(/^chrome-extension:\/\/.+\/background\.js$/);

  const extensionId = new URL(worker.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { name: 'Human Rate Typer' })).toBeVisible();
  await expect(panel.getByText('Text stays on this device')).toBeVisible();
  await panel.waitForTimeout(200);
  await panel.getByRole('button', { name: 'Revision mode' }).click();
  await expect(panel.locator('.tab-switcher button')).toHaveCount(3);
  await expect(panel.getByPlaceholder(/initial draft/i)).toBeVisible();
  await expect(panel.getByText('Paragraph playback')).toBeVisible();

  const fixture = await context.newPage();
  await fixture.goto('http://127.0.0.1:5173/tests/fixtures/editors.html');
  await expect(fixture.locator('#input')).toBeEditable();
  await expect(fixture.locator('#textarea')).toBeEditable();
  await expect(fixture.locator('#contenteditable')).toHaveAttribute('contenteditable', 'true');
  await expect(fixture.locator('#rich')).toHaveAttribute('role', 'textbox');
  await expect(fixture.locator('#editor-frame')).toBeVisible();
});

test('revision mode hops between paragraph states and finishes exactly', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const fixture = await context.newPage();
  await fixture.goto('http://127.0.0.1:5173/tests/fixtures/editors.html');
  const textarea = fixture.locator('#textarea');
  await textarea.focus();

  const draft = 'Draft alpha.\nDraft beta.\nDraft gamma.';
  const final = 'Final alpha.\nFinal beta.\nFinal gamma.';
  const plan = createRevisionPlan(
    draft,
    final,
    { ...DEFAULT_PROFILE, targetWpm: 200, typoRate: 0, countdownSeconds: 0 },
    {
      ...DEFAULT_REVISION_PROFILE,
      enabled: true,
      draftHopping: 100,
      revisionHopping: 100,
      paragraphPauseMinMs: 0,
      paragraphPauseMaxMs: 0,
      granularity: 'paragraph',
    },
    4404,
  );
  const actions = plan.steps.map((item) => item.action).filter((action) => (
    action.type === 'revision-reset' || action.type === 'revision-patch'
  ));
  await worker.evaluate(async (revisionActions) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active revision fixture tab.');
    const debuggee = { tabId: tab.id };
    const paragraphs: string[] = [];
    await chrome.debugger.attach(debuggee, '1.3');
    try {
      for (const action of revisionActions) {
        if (action.type === 'revision-reset') {
          paragraphs.splice(0, paragraphs.length, ...Array.from({ length: action.paragraphCount }, () => ''));
        } else if (action.type === 'revision-patch') {
          paragraphs[action.paragraphIndex] = action.text;
        }
        const modifiers = 2;
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', modifiers,
          windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17,
        });
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers,
          commands: ['selectAll'],
          windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
        });
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'a', code: 'KeyA', modifiers,
          windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
        });
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0,
          windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17,
        });
        await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: paragraphs.join('\n') });
      }
    } finally {
      await chrome.debugger.detach(debuggee);
    }
  }, actions);
  await expect(textarea).toHaveValue(final);
});

test('debugger Enter input preserves consecutive paragraphs in a rich editor', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');

  const fixture = await context.newPage();
  await fixture.goto('http://127.0.0.1:5173/tests/fixtures/editors.html');
  const richEditor = fixture.locator('#rich');
  await richEditor.evaluate((element) => {
    element.setAttribute('data-enter-count', '0');
    element.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Enter') return;
      const count = Number(element.getAttribute('data-enter-count') ?? 0);
      element.setAttribute('data-enter-count', String(count + 1));
    });
  });
  await richEditor.focus();

  const source = 'First paragraph.\nSecond paragraph.\n\nFourth paragraph.';
  await worker.evaluate(async ({ text, settleMs }) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Could not find the rich-editor fixture tab.');
    const debuggee = { tabId: tab.id };
    await chrome.debugger.attach(debuggee, '1.3');
    try {
      for (const character of text) {
        if (character === '\n') {
          await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Enter', code: 'Enter',
            text: '\r', unmodifiedText: '\r',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          await new Promise((resolve) => setTimeout(resolve, settleMs));
        } else {
          await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: character });
        }
      }
    } finally {
      await chrome.debugger.detach(debuggee);
    }
  }, { text: source, settleMs: 90 });

  expect(await richEditor.getAttribute('data-enter-count')).toBe('3');
  expect(await richEditor.evaluate((element) => (element as HTMLElement).innerText))
    .toMatch(/^First paragraph\.\nSecond paragraph\.\n{2,3}Fourth paragraph\.$/);
});

test('revision document replacement preserves multiline rich-editor text', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const fixture = await context.newPage();
  await fixture.goto('http://127.0.0.1:5173/tests/fixtures/editors.html');
  const richEditor = fixture.locator('#rich');
  await richEditor.focus();
  const final = 'Revised first paragraph.\nRevised second paragraph.\n\nRevised fourth paragraph.';

  await worker.evaluate(async (text) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active rich-editor fixture tab.');
    const debuggee = { tabId: tab.id };
    await chrome.debugger.attach(debuggee, '1.3');
    try {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll'],
        windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2,
        windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text });
    } finally {
      await chrome.debugger.detach(debuggee);
    }
  }, final);

  expect(await richEditor.evaluate((element) => (element as HTMLElement).innerText))
    .toMatch(/^Revised first paragraph\.\nRevised second paragraph\.\n{2,3}Revised fourth paragraph\.$/);
});
