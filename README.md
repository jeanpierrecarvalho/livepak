# livepak

Zero-dependency Chrome extension dev server with auto-reload, toolbar pinning, and hot reloading.

## Why

Developing Chrome extensions means constantly: unload, load unpacked, click refresh, test. **extload** eliminates all of that.

- **Zero dependencies** -- no `npm install`, just Node.js 22+
- **Auto-downloads Chrome for Testing** -- bypasses stable Chrome's `--load-extension` block
- **Hot reload** -- file changes trigger instant extension reload via WebSocket
- **Smart reload** -- JS/JSON changes do a full reload; CSS/HTML changes do a soft reload + tab refresh
- **Auto-pins** extensions to the toolbar via CDP
- **Multi-extension** support -- load and watch multiple extensions simultaneously
- **Crash-safe** -- lockfile restores your manifest if the process dies unexpectedly

## Quick start

```bash
npx livepak ./my-extension
```

Or install globally:

```bash
npm install -g livepak
livepak ./my-extension
```

## Usage

```
extload <ext-dir> [ext-dir2 ...] [options]

Options:
  --port <n>             WebSocket port (default: 35729, auto-increments on conflict)
  --open <url>           Open a URL after launch (for testing content scripts)
  --chrome-version <v>   Chrome version (e.g. "146", "latest", default: cached or latest)
  --chrome-flags <flags> Extra Chrome flags (comma-separated)
  --no-launch            Don't launch Chrome, just watch + reload
  --no-inject            Don't inject reload script (manual setup)
  --config <path>        Config file path (default: ./extload.config.json)
```

## Examples

```bash
# basic usage
livepak ./my-extension

# multiple extensions
livepak ./ext-popup ./ext-content-script

# test content scripts on a specific page
livepak ./my-extension --open https://example.com

# use a specific Chrome version
livepak ./my-extension --chrome-version 146

# watch-only mode (bring your own browser)
livepak ./my-extension --no-launch
```

## Config file

Create `extload.config.json` in your project root:

```json
{
  "extensions": ["./src/extension"],
  "port": 4000,
  "open": "https://example.com",
  "chromeVersion": "146",
  "chromeFlags": ["--auto-open-devtools-for-tabs"]
}
```

## How it works

1. **Injects** a tiny WebSocket client into your extension's service worker/background script
2. **Watches** your extension directory for file changes
3. **Downloads** Chrome for Testing (cached in `~/.cache/extload/`)
4. **Launches** Chrome with `--load-extension` and pins extensions via CDP
5. **Signals** `chrome.runtime.reload()` over WebSocket when files change
6. **Refreshes** active tabs when content scripts may have changed
7. **Restores** your original manifest on exit (or on next startup if crashed)

## Supported

- Manifest V2 and V3
- macOS, Linux, Windows
- Node.js 22+

## How it compares

| Tool | Deps | Framework lock-in | Auto-reload | Pin | Content script reload |
|------|------|-------------------|-------------|-----|----------------------|
| **extload** | 0 | None | Yes | Yes | Yes |
| Plasmo | Heavy | Yes | Yes | No | Yes |
| WXT | Heavy | Yes (Vite) | Yes | No | Yes |
| CRXJS | Heavy | Yes (Vite) | Yes | No | No |
| web-ext | Medium | None | Firefox only | No | No |

## License

MIT
