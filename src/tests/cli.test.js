import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import path from 'path';

const CLI = path.resolve('src/cli.js');

describe('CLI', () => {
  it('should show help with --help flag', () => {
    const output = execFileSync('node', [CLI, '--help'], { encoding: 'utf-8' });
    assert.ok(output.includes('livepak'));
    assert.ok(output.includes('Usage'));
    assert.ok(output.includes('--port'));
    assert.ok(output.includes('--open'));
    assert.ok(output.includes('--chrome-version'));
    assert.ok(output.includes('--config'));
  });

  it('should exit with error when no dirs provided', () => {
    try {
      execFileSync('node', [CLI], { encoding: 'utf-8', stdio: 'pipe' });
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.stderr.includes('provide at least one extension directory'));
    }
  });

  it('should exit with error for non-existent directory', () => {
    try {
      execFileSync('node', [CLI, '/tmp/nonexistent-ext-dir-12345'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.stderr.includes('directory not found'));
    }
  });
});
