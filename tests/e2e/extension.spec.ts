import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

  const fixture = await context.newPage();
  await fixture.goto('http://127.0.0.1:5173/tests/fixtures/editors.html');
  await expect(fixture.locator('#input')).toBeEditable();
  await expect(fixture.locator('#textarea')).toBeEditable();
  await expect(fixture.locator('#contenteditable')).toHaveAttribute('contenteditable', 'true');
  await expect(fixture.locator('#rich')).toHaveAttribute('role', 'textbox');
  await expect(fixture.locator('#editor-frame')).toBeVisible();
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
