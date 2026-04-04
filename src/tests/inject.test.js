import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { injectReloadClient, restoreIfDirty } from '../inject.js';

describe('injectReloadClient', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extload-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should inject into MV2 manifest', () => {
    const extDir = path.join(tmpDir, 'mv2');
    fs.mkdirSync(extDir);
    fs.writeFileSync(
      path.join(extDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 2,
        name: 'Test MV2',
        version: '1.0',
        background: { scripts: ['bg.js'] },
      }),
    );

    const cleanup = injectReloadClient(extDir, 9999);

    const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.ok(manifest.background.scripts.includes('__dev_reload.js'));
    assert.ok(fs.existsSync(path.join(extDir, '__dev_reload.js')));
    assert.ok(fs.existsSync(path.join(extDir, '__dev_extload.lock')));

    const script = fs.readFileSync(path.join(extDir, '__dev_reload.js'), 'utf-8');
    assert.ok(script.includes('ws://localhost:9999'));

    cleanup();
    const restored = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.ok(!restored.background.scripts.includes('__dev_reload.js'));
    assert.ok(!fs.existsSync(path.join(extDir, '__dev_reload.js')));
    assert.ok(!fs.existsSync(path.join(extDir, '__dev_extload.lock')));
  });

  it('should inject into MV3 manifest with existing service_worker', () => {
    const extDir = path.join(tmpDir, 'mv3');
    fs.mkdirSync(extDir);
    fs.writeFileSync(
      path.join(extDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Test MV3',
        version: '1.0',
        background: { service_worker: 'sw.js' },
      }),
    );

    const cleanup = injectReloadClient(extDir, 8888);

    const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.strictEqual(manifest.background.service_worker, '__dev_sw_wrapper.js');

    cleanup();
    const restored = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.strictEqual(restored.background.service_worker, 'sw.js');
  });

  it('should inject into MV3 manifest without existing background', () => {
    const extDir = path.join(tmpDir, 'mv3-no-bg');
    fs.mkdirSync(extDir);
    fs.writeFileSync(
      path.join(extDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Test MV3 No BG',
        version: '1.0',
      }),
    );

    const cleanup = injectReloadClient(extDir, 7777);

    const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.strictEqual(manifest.background.service_worker, '__dev_reload.js');

    cleanup();
  });

  it('should throw if no manifest.json exists', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);

    assert.throws(
      () => injectReloadClient(emptyDir),
      /No manifest\.json found/,
    );
  });

  it('should restore dirty state from a crashed session', () => {
    const extDir = path.join(tmpDir, 'crash-test');
    fs.mkdirSync(extDir);

    const originalManifest = JSON.stringify({
      manifest_version: 3,
      name: 'Crash Test',
      version: '1.0',
      background: { service_worker: 'bg.js' },
    });

    // simulate a crash: dirty manifest + lockfile left behind
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Crash Test',
      version: '1.0',
      background: { service_worker: '__dev_sw_wrapper.js' },
    }));
    fs.writeFileSync(path.join(extDir, '__dev_extload.lock'), JSON.stringify({
      originalManifest,
      pid: 99999,
    }));
    fs.writeFileSync(path.join(extDir, '__dev_reload.js'), 'dirty');
    fs.writeFileSync(path.join(extDir, '__dev_sw_wrapper.js'), 'dirty');

    const restored = restoreIfDirty(extDir);
    assert.ok(restored);

    const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf-8'));
    assert.strictEqual(manifest.background.service_worker, 'bg.js');
    assert.ok(!fs.existsSync(path.join(extDir, '__dev_reload.js')));
    assert.ok(!fs.existsSync(path.join(extDir, '__dev_sw_wrapper.js')));
    assert.ok(!fs.existsSync(path.join(extDir, '__dev_extload.lock')));
  });
});
