import fs from 'fs';
import path from 'path';

const RELOAD_SCRIPT_NAME = '__dev_reload.js';
const WRAPPER_NAME = '__dev_sw_wrapper.js';
const LOCKFILE_NAME = '__dev_extload.lock';

/**
 * Generates the content script that connects to the WS server
 * and triggers chrome.runtime.reload() on signal.
 */
function reloadClientCode(port) {
  return `// auto-injected by extload dev server
(function() {
  const ws = new WebSocket('ws://localhost:${port}');
  ws.onmessage = function(event) {
    const msg = JSON.parse(event.data);
    if (msg.type === 'reload') {
      console.log('[extload] reloading extension...');
      chrome.runtime.reload();
    }
  };
  ws.onclose = function() {
    setTimeout(function() { location.reload(); }, 2000);
  };
})();
`;
}

/**
 * Checks if a previous extload session left dirty state and restores it.
 * Called on startup before injecting anything new.
 */
export function restoreIfDirty(extensionDir) {
  const lockPath = path.join(extensionDir, LOCKFILE_NAME);
  if (!fs.existsSync(lockPath)) return false;

  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const manifestPath = path.join(extensionDir, 'manifest.json');

    // restore original manifest
    if (lock.originalManifest) {
      fs.writeFileSync(manifestPath, lock.originalManifest);
    }

    // remove injected files
    for (const f of [RELOAD_SCRIPT_NAME, WRAPPER_NAME, LOCKFILE_NAME]) {
      try { fs.unlinkSync(path.join(extensionDir, f)); } catch {}
    }

    console.log(`[inject] restored ${path.basename(extensionDir)} from dirty state`);
    return true;
  } catch {
    // lockfile is corrupt, just remove everything
    for (const f of [RELOAD_SCRIPT_NAME, WRAPPER_NAME, LOCKFILE_NAME]) {
      try { fs.unlinkSync(path.join(extensionDir, f)); } catch {}
    }
    return false;
  }
}

/**
 * Injects a reload background script into the extension's manifest.
 * Supports both Manifest V2 (background.scripts) and V3 (service_worker).
 * Writes a lockfile so crashes can be recovered from.
 * Returns a cleanup function that restores the original manifest.
 */
export function injectReloadClient(extensionDir, port = 35729) {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found in ${extensionDir}`);
  }

  // restore any dirty state from previous crash
  restoreIfDirty(extensionDir);

  const originalManifest = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(originalManifest);

  // write lockfile with original manifest for crash recovery
  const lockPath = path.join(extensionDir, LOCKFILE_NAME);
  fs.writeFileSync(lockPath, JSON.stringify({ originalManifest, pid: process.pid }));

  // write the reload script
  const scriptPath = path.join(extensionDir, RELOAD_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, reloadClientCode(port));

  const mv = manifest.manifest_version || 2;

  if (mv === 3) {
    const existingSw = manifest.background?.service_worker;
    if (existingSw) {
      const wrapperContent = `importScripts('${existingSw}', '${RELOAD_SCRIPT_NAME}');`;
      fs.writeFileSync(path.join(extensionDir, WRAPPER_NAME), wrapperContent);
      manifest.background.service_worker = WRAPPER_NAME;
    } else {
      manifest.background = manifest.background || {};
      manifest.background.service_worker = RELOAD_SCRIPT_NAME;
    }
  } else {
    manifest.background = manifest.background || {};
    manifest.background.scripts = manifest.background.scripts || [];
    if (!manifest.background.scripts.includes(RELOAD_SCRIPT_NAME)) {
      manifest.background.scripts.push(RELOAD_SCRIPT_NAME);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return function cleanup() {
    fs.writeFileSync(manifestPath, originalManifest);
    for (const f of [scriptPath, path.join(extensionDir, WRAPPER_NAME), lockPath]) {
      try { fs.unlinkSync(f); } catch {}
    }
  };
}
