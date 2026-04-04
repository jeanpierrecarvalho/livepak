#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { createReloadServer } from './server.js';
import { watchExtensions } from './watcher.js';
import { injectReloadClient, restoreIfDirty } from './inject.js';
import { launchChrome } from './launcher.js';

// Node version check
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Error: livepak requires Node.js >= 22.0.0 (you have ${process.versions.node})`);
  process.exit(1);
}

function usage() {
  console.log(`
  livepak - Zero-dependency Chrome extension dev server

  Usage:
    livepak <ext-dir> [ext-dir2 ...] [options]

  Options:
    --port <n>             WebSocket port (default: 35729, auto-increments on conflict)
    --open <url>           Open a URL after launch (for testing content scripts)
    --chrome-version <v>   Chrome version to use (e.g. "146", "latest", default: cached or latest)
    --chrome-flags <flags> Extra Chrome flags (comma-separated)
    --no-launch            Don't launch Chrome, just watch + reload
    --no-inject            Don't inject reload script (manual setup)
    --config <path>        Config file path (default: ./livepak.config.json)
    --help                 Show this help

  Examples:
    livepak ./my-extension
    livepak ./ext1 ./ext2 --port 4000
    livepak ./my-extension --open https://example.com
    livepak ./my-extension --chrome-version 146
    livepak ./my-extension --no-launch

  Config file (livepak.config.json):
    {
      "extensions": ["./src/extension"],
      "port": 4000,
      "open": "https://example.com",
      "chromeVersion": "146",
      "chromeFlags": ["--auto-open-devtools-for-tabs"]
    }
`);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`Error: invalid config file: ${configPath}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {
    dirs: [],
    port: null,
    launch: true,
    inject: true,
    open: null,
    chromeVersion: null,
    chromeFlags: [],
    configPath: null,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--port') {
      args.port = parseInt(argv[++i], 10);
    } else if (arg === '--open') {
      args.open = argv[++i];
    } else if (arg === '--chrome-version') {
      args.chromeVersion = argv[++i];
    } else if (arg === '--no-launch') {
      args.launch = false;
    } else if (arg === '--no-inject') {
      args.inject = false;
    } else if (arg === '--chrome-flags') {
      args.chromeFlags = argv[++i].split(',');
    } else if (arg === '--config') {
      args.configPath = argv[++i];
    } else if (!arg.startsWith('-')) {
      args.dirs.push(path.resolve(arg));
    }
    i++;
  }

  return args;
}

function mergeConfig(args) {
  const configPath = args.configPath || path.resolve('livepak.config.json');
  const config = loadConfig(configPath);

  // config values are defaults, CLI args override
  if (config.extensions && args.dirs.length === 0) {
    args.dirs = config.extensions.map((d) => path.resolve(d));
  }
  if (config.port != null && args.port == null) args.port = config.port;
  if (config.open && !args.open) args.open = config.open;
  if (config.chromeVersion && !args.chromeVersion) args.chromeVersion = config.chromeVersion;
  if (config.chromeFlags && args.chromeFlags.length === 0) {
    args.chromeFlags = config.chromeFlags;
  }

  // defaults
  if (args.port == null) args.port = 35729;

  return args;
}

// --- Terminal UI ---

const UI = {
  startTime: null,
  extensions: [],
  wsPort: null,
  connectedClients: 0,
  lastReload: null,
  lastReloadType: null,
  errors: [],

  render() {
    // compact status line
    const uptime = this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0;
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;
    const uptimeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

    const exts = this.extensions.map((e) => path.basename(e)).join(', ');
    const reload = this.lastReload
      ? `${this.lastReloadType} @ ${new Date(this.lastReload).toLocaleTimeString()}`
      : 'none';

    process.stdout.write(
      `\r\x1b[K[livepak] ${exts} | ws://localhost:${this.wsPort} | ` +
        `clients: ${this.connectedClients} | last reload: ${reload} | uptime: ${uptimeStr}`,
    );
  },

  logReload(extDir, changeType) {
    this.lastReload = Date.now();
    this.lastReloadType = changeType;
    console.log(`\n[reload] ${path.basename(extDir)} (${changeType})`);
  },

  logError(msg) {
    this.errors.push({ time: Date.now(), msg });
    if (this.errors.length > 10) this.errors.shift();
    console.log(`\n[error] ${msg}`);
  },
};

async function main() {
  let args = parseArgs(process.argv.slice(2));
  args = mergeConfig(args);

  if (args.dirs.length === 0) {
    console.error('Error: provide at least one extension directory.\n');
    usage();
    process.exit(1);
  }

  // validate directories + restore dirty state from crashes
  for (const dir of args.dirs) {
    if (!fs.existsSync(dir)) {
      console.error(`Error: directory not found: ${dir}`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      console.error(`Error: no manifest.json in ${dir}`);
      process.exit(1);
    }
    restoreIfDirty(dir);
  }

  // inject reload clients
  const cleanups = [];
  if (args.inject) {
    for (const dir of args.dirs) {
      console.log(`[inject] ${path.basename(dir)}`);
      const cleanup = injectReloadClient(dir, args.port);
      cleanups.push(cleanup);
    }
  }

  // start ws server (auto-retries on port conflict)
  const server = createReloadServer(args.port);
  const actualPort = await server.ready;
  if (actualPort !== args.port) {
    console.log(`[ws] port ${args.port} in use, using ${actualPort}`);
  }
  console.log(`[ws] reload server on ws://localhost:${actualPort}`);

  // watch for changes
  let browser;
  const watcher = watchExtensions(args.dirs, {
    onReload: (extDir, changeType) => {
      UI.logReload(extDir, changeType);
      server.reload(extDir, changeType);

      // reload active tabs for content script changes
      if (browser?.reloadTabs) {
        browser.reloadTabs();
      }
    },
  });

  // launch chrome
  if (args.launch) {
    browser = await launchChrome(args.dirs, {
      chromeFlags: args.chromeFlags,
      chromeVersion: args.chromeVersion,
      openUrl: args.open,
    });
    browser.on('disconnected', () => {
      console.log('\n[chrome] browser closed');
      shutdown();
    });
  }

  // setup UI
  UI.startTime = Date.now();
  UI.extensions = args.dirs;
  UI.wsPort = actualPort;

  console.log('\nWatching for changes... (Ctrl+C to stop)\n');

  // periodic UI update
  const uiInterval = setInterval(() => {
    UI.connectedClients = server.clientCount();
    UI.render();
  }, 1000);

  function shutdown() {
    clearInterval(uiInterval);
    console.log('\n[shutdown] cleaning up...');
    for (const cleanup of cleanups) {
      try { cleanup(); } catch {}
    }
    watcher.close();
    server.close();
    if (browser) browser.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    UI.logError(err.message);
    shutdown();
  });
}

main();
