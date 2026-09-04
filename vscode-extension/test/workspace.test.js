'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const workspace = require('../lib/workspace');

test('resolveWorkspacePath accepts normal paths and rejects symlink traversal', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'win7-agent-path-'));
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  assert.equal(workspace.resolveWorkspacePath(root, 'src/new.js'), path.join(root, 'src', 'new.js'));
  assert.throws(() => workspace.resolveWorkspacePath(root, 'linked/secret.txt'), /symbolic links are not allowed/);
});

test('scanWorkspaceFiles skips excluded folders and symbolic links', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'win7-agent-scan-'));
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'console.log(1);', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
  fs.writeFileSync(path.join(outside, 'secret.js'), 'secret', 'utf8');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const files = workspace.scanWorkspaceFiles(root, {
    excludeDirs: ['node_modules'],
    textExtensions: ['.js'],
    maxFileBytes: 1000
  }, 20);

  assert.deepEqual(files.map((file) => file.path), ['src/app.js']);
});
