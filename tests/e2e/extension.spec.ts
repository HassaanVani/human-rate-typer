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
