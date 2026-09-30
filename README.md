# Human Rate Typer

A local-only Manifest V3 Chrome extension that cleans invisible formatting characters from pasted text and types the result into web editors at a configurable, human-paced rhythm.

## Install locally

1. Install dependencies with `npm install`.
2. Build the extension with `npm run build`.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the generated `dist` directory.
5. Pin the extension and click its toolbar icon to open the side panel.

### Opera GX

Opera GX does not use Chrome's `sidePanel` API. Build its dedicated variant with `npm run build:opera`, then open `opera:extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist-opera`. The extension appears in the normal extensions menu as a compact popup and in Opera's sidebar setup. Click-to-target sessions are handed to the background worker before the toolbar popup closes; reopening either interface shows the live session state. The native sidebar remains the best surface for monitoring progress continuously.

Opera sessions remain bound to their original target tab when another Opera window or application receives focus. Navigating or closing the target tab still stops the session.

Chrome will display a strong debugger permission warning. The extension uses that permission only while an explicit typing session is active so it can send real key and backspace events to complex editors. Chrome does not allow the debugger permission to be optional. The debugger is detached on completion, cancellation, navigation, tab changes, side-panel closure, or error.

## Use

1. Paste text into the side panel and inspect **Clean preview** or the cleanup report.
2. Choose WPM, natural variation, pause intensity, and temporary typo behaviors.
3. Choose a launch mode:
   - **Click target:** press Start, then click the destination editor.
   - **Focused field:** focus an editor first, return to the panel, and press Start.
   - **Shortcut:** focus an editor and press `Command/Ctrl+Shift+Y`.
4. Pause/resume with `Command/Ctrl+Shift+U` or stop immediately with `Command/Ctrl+Shift+X`.

Chrome shortcuts can be changed at `chrome://extensions/shortcuts`.

## Privacy and safety

- Pasted text is stored only in `chrome.storage.session`, which is memory-backed and cleared when Chrome restarts, the extension reloads, or it is disabled.
- Preferences are stored locally. There are no accounts, analytics, network requests, or remote code.
- The extension never clicks buttons or submits forms.
- Password fields are blocked when Chrome exposes the target element to the page inspector.
- Protected pages such as `chrome://` and the Chrome Web Store are not supported.
- Clicking elsewhere in an injectable page pauses an active session. The emergency-stop shortcut remains available for canvas-based editors.

## Cleanup policy

Safe cleanup normalizes line endings and removes selected invisible Unicode formatting controls: zero-width spaces, BOMs, soft hyphens, word joiners, bidi embedding/isolate controls, interlinear controls, shorthand/music controls, and Unicode tag characters. It preserves visible Unicode, normal whitespace, emoji variation selectors, ZWJ/ZWNJ sequences, punctuation, and typography.

This is not a universal “AI watermark” detector. Semantic watermarking, unusual word choice, and visible confusable characters are intentionally not changed.

## Development

```sh
npm run test
npm run build
npm run test:e2e
npm run test:e2e:opera
```

The Playwright suite builds and loads the unpacked extension into Chromium. Install its browser once with `npx playwright install chromium` if it is not already available.

Manual release checks should include Google Docs and another canvas-backed editor because their internal implementations can change independently of the extension.
