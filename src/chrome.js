import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const VERSIONS_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const KNOWN_VERSIONS_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'livepak');
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function platform() {
  const arch = os.arch();
  switch (os.platform()) {
    case 'darwin':
      return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    case 'linux':
      return 'linux64';
    case 'win32':
      return arch === 'x64' ? 'win64' : 'win32';
    default:
      throw new Error(`Unsupported platform: ${os.platform()}`);
  }
}

function chromeBinary(installDir) {
  const p = os.platform();
  if (p === 'darwin') {
    const entries = fs.readdirSync(installDir);
    const app = entries.find((e) => e.endsWith('.app'));
    if (app) {
      return path.join(installDir, app, 'Contents', 'MacOS', 'Google Chrome for Testing');
    }
  }
  if (p === 'linux') return path.join(installDir, 'chrome');
  if (p === 'win32') return path.join(installDir, 'chrome.exe');
  throw new Error(`Cannot find chrome binary in ${installDir}`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function extract(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const p = os.platform();
  if (p === 'win32') {
    // PowerShell's Expand-Archive works on all modern Windows
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
      { stdio: 'pipe' },
    );
  } else {
    execSync(`unzip -qo "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
  }
}

/**
 * Resolves a version string to a download URL.
 * If requestedVersion is null, uses latest stable.
 * If requestedVersion is a partial match (e.g. "146"), finds the best match.
 */
async function resolveVersion(requestedVersion) {
  const plat = platform();

  if (!requestedVersion) {
    // latest stable
    const res = await fetch(VERSIONS_URL);
    if (!res.ok) throw new Error(`Failed to fetch version info: ${res.status}`);
    const data = await res.json();
    const channel = data.channels.Stable;
    const entry = channel.downloads.chrome.find((d) => d.platform === plat);
    if (!entry) throw new Error(`No download for platform: ${plat}`);
    return { version: channel.version, url: entry.url };
  }

  // specific version requested -- search known versions
  const res = await fetch(KNOWN_VERSIONS_URL);
  if (!res.ok) throw new Error(`Failed to fetch known versions: ${res.status}`);
  const data = await res.json();

  // find exact or prefix match (newest first)
  const matches = data.versions
    .filter((v) => v.version === requestedVersion || v.version.startsWith(requestedVersion + '.'))
    .filter((v) => v.downloads?.chrome?.find((d) => d.platform === plat));

  if (matches.length === 0) {
    throw new Error(`No Chrome version matching "${requestedVersion}" for ${plat}`);
  }

  // pick the newest match
  const best = matches[matches.length - 1];
  const entry = best.downloads.chrome.find((d) => d.platform === plat);
  return { version: best.version, url: entry.url };
}

/**
 * Checks if a newer Chrome version is available (at most once per 24h).
 */
async function checkForUpdates(currentVersion) {
  const versionFile = path.join(CACHE_DIR, 'version.json');
  try {
    const cached = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
    if (cached.lastUpdateCheck && Date.now() - cached.lastUpdateCheck < UPDATE_CHECK_INTERVAL) {
      return; // checked recently
    }
  } catch {}

  try {
    const res = await fetch(VERSIONS_URL);
    if (!res.ok) return;
    const data = await res.json();
    const latest = data.channels.Stable.version;
    if (latest !== currentVersion) {
      console.log(`[chrome] update available: ${currentVersion} -> ${latest} (run with --chrome-version latest to update)`);
    }

    // save last check time
    const versionFile2 = path.join(CACHE_DIR, 'version.json');
    if (fs.existsSync(versionFile2)) {
      const cached = JSON.parse(fs.readFileSync(versionFile2, 'utf-8'));
      cached.lastUpdateCheck = Date.now();
      fs.writeFileSync(versionFile2, JSON.stringify(cached));
    }
  } catch {}
}

/**
 * Downloads and caches Chrome for Testing.
 * @param {string|null} requestedVersion - specific version or null for latest stable
 * @returns {string} path to the chrome binary
 */
export async function ensureChrome(requestedVersion = null) {
  const versionFile = path.join(CACHE_DIR, 'version.json');

  // check cache
  if (fs.existsSync(versionFile)) {
    const cached = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
    const bin = chromeBinary(cached.installDir);

    // if no specific version requested and cache exists, use it
    if (!requestedVersion && fs.existsSync(bin)) {
      // background update check
      checkForUpdates(cached.version).catch(() => {});
      return bin;
    }

    // if requested version matches cache, use it
    if (requestedVersion && cached.version.startsWith(requestedVersion) && fs.existsSync(bin)) {
      return bin;
    }

    // "latest" forces a re-download
    if (requestedVersion === 'latest') {
      requestedVersion = null;
    }
  }

  console.log('[chrome] resolving version...');
  const { version, url } = await resolveVersion(
    requestedVersion === 'latest' ? null : requestedVersion,
  );
  const plat = platform();

  // check if this exact version is already installed
  if (fs.existsSync(versionFile)) {
    const cached = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
    if (cached.version === version && fs.existsSync(chromeBinary(cached.installDir))) {
      console.log(`[chrome] v${version} already installed`);
      return chromeBinary(cached.installDir);
    }
  }

  const zipName = `chrome-${plat}-${version}.zip`;
  const zipPath = path.join(CACHE_DIR, zipName);

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`[chrome] downloading v${version}...`);
  await download(url, zipPath);

  console.log('[chrome] extracting...');
  const installDir = path.join(CACHE_DIR, `chrome-${plat}`);
  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true });
  }
  extract(zipPath, CACHE_DIR);

  const bin = chromeBinary(installDir);
  if (!fs.existsSync(bin)) {
    throw new Error(`Chrome binary not found at ${bin}`);
  }

  if (os.platform() !== 'win32') {
    fs.chmodSync(bin, 0o755);
  }

  fs.writeFileSync(
    versionFile,
    JSON.stringify({ version, platform: plat, installDir, lastUpdateCheck: Date.now() }),
  );

  fs.unlinkSync(zipPath);

  console.log(`[chrome] installed v${version}`);
  return bin;
}
