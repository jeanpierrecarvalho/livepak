import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import { ensureChrome } from './chrome.js';
import { cdpGet, cdpConnect } from './cdp.js';

const PROFILE_DIR = path.join(os.tmpdir(), 'extload-profile');

function extensionIdFromPath(extPath) {
  const hash = crypto.createHash('sha256').update(extPath).digest('hex');
  return hash
    .slice(0, 32)
    .split('')
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
    .join('');
}

async function pinExtensions(debugPort, extIds) {
  const targets = await cdpGet(debugPort, '/json');
  const page = targets.find((t) => t.type === 'page');
  if (!page) return;

  const cdp = await cdpConnect(page.webSocketDebuggerUrl);
  await cdp.send('Page.navigate', { url: 'chrome://extensions' });
  await new Promise((r) => setTimeout(r, 2000));

  const pinScript = `
    (async () => {
      if (!chrome?.developerPrivate) return JSON.stringify({ err: 'no API' });
      const ids = ${JSON.stringify(extIds)};
      const results = [];
      for (const id of ids) {
        try {
          await chrome.developerPrivate.updateExtensionConfiguration({
            extensionId: id,
            pinnedToToolbar: true,
          });
          results.push({ id, ok: true });
        } catch (e) {
          results.push({ id, ok: false, err: e.message });
        }
      }
      return JSON.stringify(results);
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression: pinScript,
    awaitPromise: true,
  });

  cdp.close();

  if (result?.result?.result?.value) {
    const pins = JSON.parse(result.result.result.value);
    for (const p of pins) {
      if (p.ok) console.log(`[pin] ${p.id}`);
      else console.log(`[pin] failed ${p.id}: ${p.err}`);
    }
  } else if (result?.error) {
    console.log(`[pin] ${result.error.message}`);
  }
}

/**
 * Reloads all non-extension tabs via CDP (for content script changes).
 */
async function reloadActiveTabs(debugPort) {
  try {
    const targets = await cdpGet(debugPort, '/json');
    const pages = targets.filter(
      (t) => t.type === 'page' && !t.url.startsWith('chrome') && !t.url.startsWith('about'),
    );

    for (const page of pages) {
      try {
        const cdp = await cdpConnect(page.webSocketDebuggerUrl);
        await cdp.send('Page.reload');
        cdp.close();
      } catch {}
    }

    if (pages.length > 0) {
      console.log(`[reload] refreshed ${pages.length} tab(s)`);
    }
  } catch {}
}

/**
 * Opens a URL in a new tab via CDP.
 */
async function openUrl(debugPort, url) {
  try {
    const targets = await cdpGet(debugPort, '/json');
    const page = targets.find((t) => t.type === 'page');
    if (!page) return;

    const cdp = await cdpConnect(page.webSocketDebuggerUrl);
    await cdp.send('Page.navigate', { url });
    cdp.close();
    console.log(`[open] ${url}`);
  } catch (err) {
    console.log(`[open] failed: ${err.message}`);
  }
}

export async function launchChrome(extensionDirs, { chromeFlags = [], chromeVersion, openUrl: openTarget } = {}) {
  const chromeBin = await ensureChrome(chromeVersion);
  const extPaths = extensionDirs.map((d) => path.resolve(d));
  const extIds = extPaths.map(extensionIdFromPath);

  let resolvePort;
  const portReady = new Promise((r) => { resolvePort = r; });

  const child = spawn(chromeBin, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--disable-extensions-except=${extPaths.join(',')}`,
    `--load-extension=${extPaths.join(',')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-mock-keychain',
    '--remote-debugging-port=0',
    ...chromeFlags,
  ], { detached: true, stdio: 'pipe' });

  child.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    const match = msg.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) resolvePort(parseInt(match[1], 10));
  });

  child.on('error', () => resolvePort(null));
  setTimeout(() => resolvePort(null), 15000);

  const debugPort = await portReady;
  if (debugPort) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await pinExtensions(debugPort, extIds);
    } catch (err) {
      console.log(`[pin] error: ${err.message}`);
    }

    if (openTarget) {
      await openUrl(debugPort, openTarget);
    }
  }

  console.log(`[chrome] launched with ${extensionDirs.length} extension(s)`);

  return {
    process: child,
    debugPort,
    reloadTabs() {
      if (debugPort) return reloadActiveTabs(debugPort);
    },
    close() { child.kill(); },
    on(event, fn) {
      if (event === 'disconnected') child.on('exit', fn);
    },
  };
}
