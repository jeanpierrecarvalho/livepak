import fs from 'fs';
import path from 'path';

/**
 * Determines reload type based on which files changed.
 * - 'full' = .js file changed (background/content scripts need full reload)
 * - 'soft' = only CSS/HTML/images changed (popup can refresh without full reload)
 */
function classifyChange(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.js', '.mjs', '.ts', '.jsx', '.tsx'].includes(ext)) return 'full';
  if (['.json'].includes(ext)) return 'full'; // manifest changes need full reload
  return 'soft';
}

/**
 * Watches extension directories for file changes using native fs.watch.
 * Debounces rapid changes and reports the change type (full vs soft).
 */
export function watchExtensions(extensionDirs, { onReload, debounceMs = 300 }) {
  const timers = new Map();
  const pendingChanges = new Map(); // tracks change types per ext dir
  const watchers = [];

  for (const extDir of extensionDirs) {
    const watcher = fs.watch(extDir, { recursive: true }, (event, filename) => {
      if (!filename) return;

      if (
        filename.includes('node_modules') ||
        filename.includes('.git') ||
        filename === '.DS_Store' ||
        filename.startsWith('__dev_')
      ) {
        return;
      }

      const changeType = classifyChange(filename);

      // accumulate change types -- if any .js changed, it's a full reload
      const current = pendingChanges.get(extDir) || 'soft';
      if (changeType === 'full') pendingChanges.set(extDir, 'full');
      else if (current !== 'full') pendingChanges.set(extDir, 'soft');

      if (timers.has(extDir)) clearTimeout(timers.get(extDir));
      timers.set(
        extDir,
        setTimeout(() => {
          timers.delete(extDir);
          const type = pendingChanges.get(extDir) || 'full';
          pendingChanges.delete(extDir);
          onReload(extDir, type);
        }, debounceMs),
      );
    });

    watchers.push(watcher);
  }

  return {
    close() {
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
