'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core');

function resolveWorkspacePath(root, relativePath) {
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const rel = core.normalizeWorkspacePath(relativePath);
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, rel);
  if (!isPathInside(rootResolved, target)) {
    throw new Error('path outside workspace is not allowed: ' + relativePath);
  }

  let current = rootResolved;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        break;
      }
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new Error('symbolic links are not allowed in agent file changes: ' + rel);
    }
  }
  return target;
}

function isPathInside(root, target) {
  let base = path.resolve(root);
  let value = path.resolve(target);
  if (process.platform === 'win32') {
    base = base.toLowerCase();
    value = value.toLowerCase();
  }
  if (value === base) {
    return true;
  }
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return value.indexOf(prefix) === 0;
}

function scanWorkspaceFiles(root, options, maxFiles) {
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const out = [];
  scanDir(path.resolve(root), path.resolve(root), options || {}, maxFiles || 300, out);
  return out;
}

function scanDir(root, dir, options, maxFiles, out) {
  if (out.length >= maxFiles) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir).sort();
  } catch (err) {
    return;
  }
  entries.forEach((entry) => {
    if (out.length >= maxFiles) {
      return;
    }
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch (err) {
      return;
    }
    if (stat.isSymbolicLink()) {
      return;
    }
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (stat.isDirectory()) {
      if (core.shouldTraverseWorkspaceDir(rel, options)) {
        scanDir(root, full, options, maxFiles, out);
      }
      return;
    }
    if (!stat.isFile() || !core.shouldIncludeWorkspaceFile(rel, stat.size, options)) {
      return;
    }
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (err) {
      return;
    }
    if (content.indexOf('\u0000') >= 0) {
      return;
    }
    out.push({ path: rel, content: content, bytes: stat.size, truncated: false });
  });
}

module.exports = {
  resolveWorkspacePath,
  isPathInside,
  scanWorkspaceFiles
};
