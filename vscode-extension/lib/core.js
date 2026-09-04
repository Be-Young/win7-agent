'use strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1/chat/completions';
const DEFAULT_MODEL = 'local-model';
const DEFAULT_TEXT_EXTENSIONS = [
  '.bat', '.c', '.cc', '.cmd', '.conf', '.cpp', '.cs', '.css', '.csv', '.go', '.h', '.hpp',
  '.htm', '.html', '.ini', '.java', '.js', '.json', '.jsx', '.log', '.lua', '.m', '.md',
  '.php', '.properties', '.py', '.rb', '.rs', '.sh', '.sql', '.swift', '.toml', '.ts',
  '.tsx', '.txt', '.vb', '.vue', '.xml', '.yaml', '.yml'
];
const DEFAULT_EXCLUDE_DIRS = [
  '.git', '.svn', '.hg', '.vscode', 'node_modules', 'dist', 'build', 'out', 'bin', 'obj',
  'vendor', 'target', '.idea', '.vs', '__pycache__'
];

function resolveModel(settings, requestedName) {
  const cfg = settings || {};
  const models = cfg.models || {};
  const name = requestedName || cfg.activeModel || '';
  const profile = name && models[name] ? models[name] : null;
  const mergedHeaders = Object.assign({}, cfg.headers || {});
  if (profile && profile.headers) {
    Object.assign(mergedHeaders, profile.headers);
  }
  const profileHasApiKey = profile && Object.prototype.hasOwnProperty.call(profile, 'apiKey');
  const resolved = {
    profileName: profile ? name : 'default',
    baseUrl: (profile && profile.baseUrl) || cfg.baseUrl || DEFAULT_BASE_URL,
    model: (profile && profile.model) || cfg.model || DEFAULT_MODEL,
    apiKey: profileHasApiKey ? String(profile.apiKey || '') : (cfg.apiKey || ''),
    stream: cfg.stream === true,
    headers: mergedHeaders
  };
  if (profile && Object.prototype.hasOwnProperty.call(profile, 'stream')) {
    resolved.stream = profile.stream === true;
  }
  return resolved;
}

function hasCommandPrefix(command, prefix) {
  const pfx = String(prefix || '').trim().toLowerCase();
  if (!pfx) {
    return false;
  }
  return splitCommandSegments(command).some((segment) => commandSegmentHasPrefix(segment, pfx));
}

function splitCommandSegments(command) {
  const value = String(command || '');
  const segments = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '^') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\r' || ch === '\n' || ch === '(' || ch === ')') {
      const segment = value.slice(start, i).trim();
      if (segment) {
        segments.push(segment);
      }
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) {
    segments.push(tail);
  }
  return segments;
}

function commandSegmentHasPrefix(segment, prefix) {
  let command = String(segment || '').trim().toLowerCase();
  command = command.replace(/^@+/, '').trim();
  if (!command) {
    return false;
  }
  if (matchesCommandStart(command, prefix)) {
    return true;
  }
  const first = firstCommand(command);
  const executable = first.token;
  if (!executable) {
    return false;
  }
  const basename = executable.replace(/\\/g, '/').split('/').pop();
  if (matchesCommandStart(basename, prefix)) {
    return true;
  }
  const nested = nestedWindowsCommand(basename, first.rest);
  return nested ? hasCommandPrefix(nested, prefix) : false;
}

function matchesCommandStart(command, prefix) {
  if (command === prefix) {
    return true;
  }
  if (command.indexOf(prefix) !== 0) {
    return false;
  }
  const next = command.slice(prefix.length, prefix.length + 1);
  return next === '.' || /\s/.test(next);
}

function firstCommandToken(command) {
  return firstCommand(command).token;
}

function firstCommand(command) {
  const value = String(command || '').trim();
  if (!value) {
    return { token: '', rest: '' };
  }
  if (value[0] === '"' || value[0] === '\'') {
    const end = value.indexOf(value[0], 1);
    return end > 0
      ? { token: value.slice(1, end), rest: value.slice(end + 1).trim() }
      : { token: value.slice(1), rest: '' };
  }
  const match = /^\S+/.exec(value);
  return match ? { token: match[0], rest: value.slice(match[0].length).trim() } : { token: '', rest: '' };
}

function nestedWindowsCommand(executable, rest) {
  const name = String(executable || '').toLowerCase().replace(/\.(exe|com|bat|cmd)$/i, '');
  let value = String(rest || '').trim();
  if (name === 'call') {
    return stripOuterDoubleQuotes(value);
  }
  if (name !== 'cmd' && name !== 'command' && name !== '%comspec%') {
    return '';
  }
  while (value) {
    const first = firstCommand(value);
    const option = first.token.toLowerCase();
    if (option === '/c' || option === '/k') {
      return stripOuterDoubleQuotes(first.rest);
    }
    if (option[0] !== '/') {
      return '';
    }
    value = first.rest;
  }
  return '';
}

function stripOuterDoubleQuotes(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"'
    ? text.slice(1, -1)
    : text;
}

function validateCommand(command, policy) {
  const cfg = policy || {};
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { ok: false, reason: 'empty command' };
  }
  if (cfg.enabled === false) {
    return { ok: false, reason: 'command execution is disabled' };
  }
  const blocked = cfg.blockedPrefixes || [];
  for (let i = 0; i < blocked.length; i += 1) {
    if (hasCommandPrefix(cmd, blocked[i])) {
      return { ok: false, reason: 'command prefix "' + String(blocked[i]).trim() + '" is blocked' };
    }
  }
  return { ok: true, reason: '' };
}

function requiresConfirmation(command, policy) {
  const cfg = policy || {};
  if (cfg.alwaysConfirm === true) {
    return true;
  }
  const prefixes = cfg.confirmPrefixes || [];
  for (let i = 0; i < prefixes.length; i += 1) {
    if (hasCommandPrefix(command, prefixes[i])) {
      return true;
    }
  }
  return false;
}

function parseSkillMarkdown(markdown, fallbackName) {
  const text = String(markdown || '');
  let meta = {};
  let body = text;
  if (text.indexOf('---') === 0) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) {
      meta = parseFrontMatter(text.slice(3, end));
      body = text.slice(end + 4);
    }
  }
  const name = meta.name || fallbackName || 'skill';
  return {
    name: name,
    description: meta.description || '',
    keywords: splitKeywords(meta.keywords || ''),
    prompt: body.trim()
  };
}

function parseFrontMatter(text) {
  const meta = {};
  String(text || '').split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx < 0) {
      return;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) {
      meta[key] = stripQuotes(value);
    }
  });
  return meta;
}

function stripQuotes(value) {
  const s = String(value || '').trim();
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === '\'' && s[s.length - 1] === '\'')) {
    return s.slice(1, -1);
  }
  return s;
}

function splitKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectSkills(skills, query, explicitNames) {
  const all = Array.isArray(skills) ? skills : [];
  const explicit = Array.isArray(explicitNames) ? explicitNames.filter(Boolean) : [];
  if (explicit.length > 0) {
    const byName = {};
    all.forEach((skill) => {
      byName[String(skill.name || '').toLowerCase()] = skill;
    });
    return explicit.map((name) => byName[String(name).toLowerCase()]).filter(Boolean);
  }
  const q = String(query || '').toLowerCase();
  const scored = [];
  all.forEach((skill, index) => {
    const haystack = [
      skill.name || '',
      skill.description || '',
      (skill.keywords || []).join(' ')
    ].join(' ').toLowerCase();
    let score = 0;
    if (skill.name && q.indexOf(String(skill.name).toLowerCase()) >= 0) {
      score += 3;
    }
    (skill.keywords || []).forEach((keyword) => {
      if (keyword && q.indexOf(String(keyword).toLowerCase()) >= 0) {
        score += 2;
      }
    });
    if (haystack && q.indexOf(haystack) >= 0) {
      score += 1;
    }
    if (score > 0) {
      scored.push({ skill: skill, score: score, index: index });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map((item) => item.skill);
}

function parseReferences(text) {
  const value = String(text || '');
  const files = [];
  const skills = [];
  collectMatches(value, /(?:^|\s)@file:("[^"]+"|'[^']+'|[^\s，,；;]+)/g, files, stripReferenceValue);
  collectMatches(value, /(?:^|\s)#file:("[^"]+"|'[^']+'|[^\s，,；;]+)/g, files, stripReferenceValue);
  collectMatches(value, /\[\[([^\]]+)\]\]/g, files, stripReferenceValue);
  collectMatches(value, /(?:^|\s)@skill:([a-zA-Z0-9_-]+)/g, skills, stripReferenceValue);
  collectMatches(value, /(?:^|\s)#skill:([a-zA-Z0-9_-]+)/g, skills, stripReferenceValue);
  return {
    files: unique(files).map(normalizeWorkspacePath),
    skills: unique(skills)
  };
}

function collectMatches(text, regex, out, transform) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = transform(match[1]);
    if (value) {
      out.push(value);
    }
  }
}

function stripReferenceValue(value) {
  const text = String(value || '').trim();
  if ((text[0] === '"' && text[text.length - 1] === '"') || (text[0] === '\'' && text[text.length - 1] === '\'')) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function unique(items) {
  const seen = {};
  const out = [];
  items.forEach((item) => {
    const key = String(item || '').toLowerCase();
    if (!key || seen[key]) {
      return;
    }
    seen[key] = true;
    out.push(item);
  });
  return out;
}

function normalizeWorkspacePath(input) {
  let value = String(input || '').trim().replace(/\\/g, '/');
  value = value.replace(/^file:\/+/i, '');
  value = value.replace(/^\.\/+/, '');
  if (!value) {
    throw new Error('empty workspace path');
  }
  if (/^[a-zA-Z]:\//.test(value) || value[0] === '/') {
    throw new Error('absolute path is not allowed: ' + input);
  }
  const parts = [];
  value.split('/').forEach((part) => {
    if (!part || part === '.') {
      return;
    }
    if (part === '..') {
      throw new Error('path outside workspace is not allowed: ' + input);
    }
    parts.push(part);
  });
  if (parts.length === 0) {
    throw new Error('empty workspace path');
  }
  return parts.join('/');
}

function shouldIncludeWorkspaceFile(relativePath, bytes, options) {
  let normalized;
  try {
    normalized = normalizeWorkspacePath(relativePath);
  } catch (err) {
    return false;
  }
  const opts = options || {};
  const directory = normalized.split('/').slice(0, -1).join('/');
  if (directory && !shouldTraverseWorkspaceDir(directory, opts)) {
    return false;
  }
  if (opts.maxFileBytes > 0 && bytes > opts.maxFileBytes) {
    return false;
  }
  const ext = extensionOf(normalized);
  const allowed = (opts.textExtensions || DEFAULT_TEXT_EXTENSIONS).map((item) => String(item).toLowerCase());
  if (allowed.indexOf(ext) < 0) {
    return false;
  }
  return true;
}

function shouldTraverseWorkspaceDir(relativePath, options) {
  let normalized;
  try {
    normalized = normalizeWorkspacePath(relativePath);
  } catch (err) {
    return false;
  }
  const opts = options || {};
  const excludeDirs = (opts.excludeDirs || DEFAULT_EXCLUDE_DIRS).map((item) => String(item).toLowerCase());
  const segments = normalized.split('/').map((item) => item.toLowerCase());
  return !segments.some((segment) => excludeDirs.indexOf(segment) >= 0);
}

function extensionOf(relativePath) {
  const name = String(relativePath || '').split('/').pop() || '';
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function buildWorkspaceContext(files, options) {
  const opts = options || {};
  const maxChars = opts.maxChars || 120000;
  const sorted = (Array.isArray(files) ? files : []).slice().sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const lines = ['Workspace file tree:'];
  sorted.forEach((file) => {
    lines.push('- ' + file.path + (file.truncated ? ' [truncated]' : ''));
  });
  lines.push('', 'Workspace file contents:');
  let used = lines.join('\n').length;
  for (let i = 0; i < sorted.length; i += 1) {
    const header = '\n--- file: ' + sorted[i].path + '\n';
    const content = String(sorted[i].content || '');
    const remaining = maxChars - used - header.length;
    if (remaining <= 0) {
      lines.push('\n[workspace context truncated]');
      break;
    }
    lines.push(header + content.slice(0, remaining));
    used += header.length + Math.min(content.length, remaining);
    if (content.length > remaining) {
      lines.push('\n[file content truncated]');
      break;
    }
  }
  return lines.join('\n');
}

function extractFileChangePlan(text) {
  const block = /```agent-files\s*([\s\S]*?)```/i.exec(String(text || ''));
  if (!block) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(block[1].trim());
  } catch (err) {
    throw new Error('invalid agent-files JSON: ' + err.message);
  }
  const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
  if (changes.length === 0) {
    throw new Error('agent-files block has no changes');
  }
  const normalized = changes.map(normalizeFileChange);
  const paths = {};
  normalized.forEach((change) => {
    const key = change.path.toLowerCase();
    if (paths[key]) {
      throw new Error('duplicate file path in change plan: ' + change.path);
    }
    paths[key] = true;
  });
  return {
    summary: String(parsed.summary || ''),
    changes: normalized
  };
}

function normalizeFileChange(change) {
  const action = String(change && change.action || 'write').toLowerCase();
  if (['create', 'write', 'replace', 'delete'].indexOf(action) < 0) {
    throw new Error('unsupported file action: ' + action);
  }
  const normalized = {
    action: action,
    path: normalizeWorkspacePath(change.path || ''),
    content: change.content == null ? '' : String(change.content),
    find: change.find == null ? '' : String(change.find),
    replace: change.replace == null ? '' : String(change.replace)
  };
  if ((action === 'create' || action === 'write') && change.content == null) {
    throw new Error(action + ' action requires content for ' + normalized.path);
  }
  if (action === 'replace' && normalized.find === '') {
    throw new Error('replace action requires find text for ' + normalized.path);
  }
  return normalized;
}

function applyTextChange(currentContent, change) {
  const action = String(change && change.action || 'write').toLowerCase();
  if (action === 'create' || action === 'write') {
    return String(change.content || '');
  }
  if (action === 'replace') {
    const current = String(currentContent || '');
    const find = String(change.find || '');
    if (find === '' || current.indexOf(find) < 0) {
      throw new Error('find text not found for replace operation');
    }
    return current.replace(find, String(change.replace || ''));
  }
  if (action === 'delete') {
    return null;
  }
  throw new Error('unsupported file action: ' + action);
}

function buildRollbackSnapshot(id, changes, originals) {
  const source = originals || {};
  return {
    id: String(id || ''),
    createdAt: new Date().toISOString(),
    files: (Array.isArray(changes) ? changes : []).map((change) => {
      const rel = normalizeWorkspacePath(change.path);
      const original = source[rel] || { exists: false, content: '' };
      return {
        path: rel,
        originalExists: original.exists === true,
        originalContent: original.content == null ? '' : String(original.content)
      };
    })
  };
}

function splitAssistantContent(text) {
  const raw = String(text || '');
  const ranges = collectAssistantMetaRanges(raw).sort((a, b) => a.start - b.start || a.end - b.end);
  const selected = [];
  let answer = '';
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start < cursor) {
      return;
    }
    answer += raw.slice(cursor, range.start);
    selected.push(range);
    cursor = range.end;
  });
  answer += raw.slice(cursor);

  const parts = [];
  const answerContent = cleanAssistantPart(answer);
  if (answerContent) {
    parts.push({
      kind: 'answer',
      label: '正式回答',
      content: answerContent,
      collapsed: false
    });
  }
  selected.forEach((range) => {
    const content = cleanAssistantPart(range.content);
    if (!content) {
      return;
    }
    parts.push({
      kind: range.kind,
      label: range.label,
      content: content,
      collapsed: true
    });
  });
  return parts;
}

function collectAssistantMetaRanges(text) {
  const ranges = [];
  collectTagRanges(text, /<think\b[^>]*>([\s\S]*?)<\/think>/gi, 'think', 'Think', ranges);
  collectTagRanges(text, /<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi, 'think', 'Think', ranges);

  const fenceRe = /```([a-zA-Z0-9_-]+)[^\r\n]*\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const lang = String(match[1] || '').toLowerCase();
    const meta = assistantFenceMeta(lang);
    if (!meta) {
      continue;
    }
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: meta.kind,
      label: meta.label,
      content: match[2] || ''
    });
  }
  return ranges;
}

function collectTagRanges(text, regex, kind, label, ranges) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: kind,
      label: label,
      content: match[1] || ''
    });
  }
}

function assistantFenceMeta(lang) {
  if (lang === 'agent-action') {
    return { kind: 'agent-action', label: 'Agent Action' };
  }
  if (lang === 'agent-files') {
    return { kind: 'agent-files', label: 'Agent Files' };
  }
  if (lang === 'think' || lang === 'thinking' || lang === 'thought') {
    return { kind: 'think', label: 'Think' };
  }
  return null;
}

function cleanAssistantPart(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveWorkSettings(work) {
  const cfg = work || {};
  return {
    maxTurns: 0,
    autoApplyFileChanges: cfg.autoApplyFileChanges !== false
  };
}

function shouldContinueWork(turn, results, policy) {
  const opts = policy || {};
  if (opts.stopRequested === true) {
    return false;
  }
  if (!Array.isArray(results) || results.length === 0) {
    return false;
  }
  const maxTurns = Number(opts.maxTurns || 0);
  if (!maxTurns || maxTurns <= 0) {
    return true;
  }
  return turn < maxTurns;
}

function createAbortHandle() {
  let callbacks = [];
  const handle = {
    aborted: false,
    reason: '',
    onAbort: function (callback) {
      if (typeof callback !== 'function') {
        return;
      }
      if (handle.aborted) {
        callback(handle.reason);
        return;
      }
      callbacks.push(callback);
    },
    abort: function (reason) {
      if (handle.aborted) {
        return;
      }
      handle.aborted = true;
      handle.reason = reason || 'aborted';
      const pending = callbacks.slice();
      callbacks = [];
      pending.forEach((callback) => callback(handle.reason));
    }
  };
  return handle;
}

function abortError(reason) {
  const err = new Error(reason || 'aborted');
  err.code = 'WIN7_AGENT_ABORTED';
  return err;
}

function isAbortError(err) {
  return err && err.code === 'WIN7_AGENT_ABORTED';
}

function recordEscPress(state, nowMs) {
  const current = state || {};
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const last = current.lastEscAt || 0;
  const stop = last > 0 && now - last <= 1000;
  return {
    lastEscAt: stop ? 0 : now,
    stop: stop
  };
}

function cleanSessionTitle(title) {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return 'New Session';
  }
  return value.length > 60 ? value.slice(0, 60) : value;
}

function formatCommandResult(command, result, maxChars) {
  const source = result || {};
  const lines = [
    'Command: ' + String(command || ''),
    'Exit code: ' + (typeof source.exitCode === 'number' ? source.exitCode : 0)
  ];
  if (source.error && source.error.message) {
    lines.push('Error: ' + source.error.message);
  }
  lines.push('', 'STDOUT:', String(source.stdout || '').trim() || '[empty]');
  lines.push('', 'STDERR:', String(source.stderr || '').trim() || '[empty]');
  const text = lines.join('\n');
  if (maxChars > 0 && text.length > maxChars) {
    return text.slice(0, maxChars) + '\n[command result truncated]';
  }
  return text;
}

function formatToolResults(results) {
  const values = (Array.isArray(results) ? results : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return values.length > 0 ? 'Tool results:\n' + values.join('\n\n') : '';
}

function appendWorkTurn(memory, turn) {
  const source = memory || {};
  const input = turn || {};
  const next = {
    messages: Array.isArray(source.messages) ? source.messages.slice() : [],
    context: Array.isArray(source.context) ? source.context.slice() : []
  };
  if (input.userText != null && String(input.userText).trim()) {
    next.messages.push({ role: 'user', content: String(input.userText) });
  }
  if (input.answer != null) {
    next.messages.push({ role: 'assistant', content: String(input.answer) });
  }
  const toolText = formatToolResults(input.results);
  if (toolText) {
    next.messages.push({ role: 'user', content: toolText });
  }
  return next;
}

function conversationHistory(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((out, message) => {
    const role = message && message.role;
    const text = message && message.content != null ? String(message.content) : '';
    if ((role !== 'user' && role !== 'assistant') || !text) {
      return out;
    }
    const toolResult = role === 'user' && text.indexOf('Tool results:\n') === 0;
    out.push({
      role: toolResult ? 'system' : role,
      text: text,
      parts: role === 'assistant' ? splitAssistantContent(text) : undefined
    });
    return out;
  }, []);
}

function withApiKeyHeader(headers, apiKey) {
  const out = Object.assign({}, headers || {});
  const hasAuthorization = Object.keys(out).some((key) => key.toLowerCase() === 'authorization');
  if (apiKey && !hasAuthorization) {
    out.Authorization = 'Bearer ' + apiKey;
  }
  return out;
}

function ensureSessionIndex(index, fallbackId, fallbackTitle, now) {
  const source = index && typeof index === 'object' ? index : {};
  const sessions = Array.isArray(source.sessions) ? source.sessions.slice() : [];
  if (sessions.length > 0) {
    const active = source.activeId && sessions.some((item) => item.id === source.activeId)
      ? source.activeId
      : sessions[0].id;
    return { activeId: active, sessions: sessions.map(normalizeSessionMeta) };
  }
  const id = fallbackId || 'session-1';
  return {
    activeId: id,
    sessions: [normalizeSessionMeta({ id: id, title: fallbackTitle || 'New Session', createdAt: now, updatedAt: now })]
  };
}

function addSession(index, id, title, now) {
  const current = ensureSessionIndex(index, id, title, now);
  if (current.sessions.some((item) => item.id === id)) {
    return setActiveSession(current, id);
  }
  current.sessions.push(normalizeSessionMeta({ id: id, title: title, createdAt: now, updatedAt: now }));
  current.activeId = id;
  return current;
}

function setActiveSession(index, id) {
  const current = ensureSessionIndex(index, id, 'New Session');
  if (!current.sessions.some((item) => item.id === id)) {
    throw new Error('unknown session: ' + id);
  }
  current.activeId = id;
  return current;
}

function renameSession(index, id, title) {
  const current = ensureSessionIndex(index, id, title);
  let found = false;
  current.sessions = current.sessions.map((item) => {
    if (item.id !== id) {
      return item;
    }
    found = true;
    const copy = Object.assign({}, item);
    copy.title = cleanSessionTitle(title);
    copy.updatedAt = new Date().toISOString();
    return copy;
  });
  if (!found) {
    throw new Error('unknown session: ' + id);
  }
  return current;
}

function deleteSession(index, id) {
  const current = ensureSessionIndex(index, id, 'New Session');
  const remaining = current.sessions.filter((item) => item.id !== id);
  if (remaining.length === current.sessions.length) {
    throw new Error('unknown session: ' + id);
  }
  if (remaining.length === 0) {
    return { activeId: '', sessions: [] };
  }
  const active = current.activeId === id ? remaining[remaining.length - 1].id : current.activeId;
  return { activeId: active, sessions: remaining };
}

function normalizeSessionMeta(meta) {
  const now = new Date().toISOString();
  return {
    id: String(meta.id || ''),
    title: cleanSessionTitle(meta.title || ''),
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || meta.createdAt || now
  };
}

function extractHtml(html, baseUrl) {
  const raw = String(html || '');
  const withoutScripts = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const title = cleanText(matchFirst(withoutScripts, /<title\b[^>]*>([\s\S]*?)<\/title>/i));
  const description = extractDescription(withoutScripts);
  const main = extractMain(withoutScripts);
  const textSource = main
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const links = extractLinks(textSource, baseUrl);
  return {
    url: baseUrl || '',
    title: title,
    description: description,
    text: htmlToText(textSource),
    links: links
  };
}

function extractDescription(html) {
  const metaRe = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaRe.exec(html)) !== null) {
    const tag = match[0];
    const name = attr(tag, 'name') || attr(tag, 'property');
    if (!name || !/^(description|og:description)$/i.test(name)) {
      continue;
    }
    const content = attr(tag, 'content');
    if (content) {
      return cleanText(content);
    }
  }
  return '';
}

function extractMain(html) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main) {
    return main[1];
  }
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article) {
    return article[1];
  }
  return html;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null && links.length < 200) {
    const href = attr(match[1], 'href');
    if (!href) {
      continue;
    }
    links.push({
      text: cleanText(match[2]),
      href: resolveUrl(baseUrl, decodeEntities(href))
    });
  }
  return links;
}

function attr(tag, name) {
  const re = new RegExp('\\b' + escapeRegExp(name) + '\\s*=\\s*("([^"]*)"|\\\'([^\\\']*)\\\'|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  if (!match) {
    return '';
  }
  return decodeEntities(match[2] || match[3] || match[4] || '');
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => '\n' + tableToText(table) + '\n');
  s = s.replace(/<\/(h1|h2|h3|p|tr|li)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return cleanText(s);
}

function tableToText(table) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(table)) !== null) {
    const values = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      values.push(cleanText(cellMatch[1].replace(/<[^>]+>/g, ' ')));
    }
    if (values.length > 0) {
      rows.push(values.join(' | '));
    }
  }
  return rows.join('\n');
}

function cleanText(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: '\'',
    nbsp: ' '
  };
  return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, name) => {
    if (name[0] === '#') {
      const isHex = name[1] && name[1].toLowerCase() === 'x';
      const code = parseInt(isHex ? name.slice(2) : name.slice(1), isHex ? 16 : 10);
      if (!Number.isNaN(code)) {
        return String.fromCharCode(code);
      }
      return full;
    }
    return Object.prototype.hasOwnProperty.call(entities, name) ? entities[name] : full;
  });
}

function resolveUrl(baseUrl, href) {
  if (!baseUrl) {
    return href;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch (err) {
    return href;
  }
}

function matchFirst(text, regex) {
  const match = regex.exec(text);
  return match ? match[1] : '';
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimMemory(memory, maxMessages, maxContextItems) {
  const source = memory || {};
  const messages = Array.isArray(source.messages) ? source.messages.slice() : [];
  const context = Array.isArray(source.context) ? source.context.slice() : [];
  return {
    messages: maxMessages > 0 ? messages.slice(-maxMessages) : messages,
    context: maxContextItems > 0 ? context.slice(-maxContextItems) : context
  };
}

function contextToParts(context) {
  return (Array.isArray(context) ? context : []).map((item) => {
    return String(item.kind || 'context') + ': ' + String(item.source || '') + '\n' + String(item.content || '');
  });
}

function buildSystemPrompt(skillPrompt, contextParts) {
  const lines = [
    'You are Win7 Agent for VS Code, an assistant running in an offline corporate intranet.',
    'Use only the provided context, local files, intranet URLs, and configured OpenAI-compatible API.',
    'You may inspect workspace context and propose project file edits.',
    'For file edits, return a fenced block exactly like: ```agent-files\n{"summary":"short summary","changes":[{"action":"write","path":"relative/path.txt","content":"new content"},{"action":"replace","path":"relative/path.txt","find":"old","replace":"new"}]}\n```.',
    'Allowed file actions are create, write, replace, and delete. Use only relative workspace paths.',
    'If the user asks you to run a local command, or you need a local command to continue, do not say the environment forbids it. Request execution with a fenced block exactly like: ```agent-action\n{"action":"run_command","command":"dir"}\n```.',
    'Ordinary local commands are allowed; high-risk command prefixes require user confirmation.',
    'Do not ask to bypass corporate security controls.'
  ];
  if (skillPrompt) {
    lines.push('', skillPrompt);
  }
  const parts = Array.isArray(contextParts) ? contextParts.filter(Boolean) : [];
  if (parts.length > 0) {
    lines.push('', 'Local context:');
    parts.forEach((part) => {
      lines.push('', '---', part);
    });
  }
  return lines.join('\n');
}

function buildDraftPrompt(kind, topic, tone) {
  const type = String(kind || 'notice').toLowerCase();
  const topicText = String(topic || '').trim();
  const toneText = String(tone || '正式、清晰、适合公司内部沟通').trim();
  const templates = {
    meeting: '请撰写一份会议纪要，包含会议背景、讨论要点、结论、风险、行动项、负责人和截止时间。',
    email: '请撰写一封公司内部邮件，包含主题、收件人建议、正文、下一步动作和礼貌收尾。',
    notice: '请撰写一份公司内部通知，包含目的、适用范围、具体安排、注意事项和联系人。',
    report: '请撰写一份工作报告，包含背景、进展、数据/事实、问题风险、下一步计划。',
    summary: '请撰写一份摘要，包含核心结论、关键依据、影响范围和待确认事项。',
    proposal: '请撰写一份方案建议，包含目标、现状、方案、实施步骤、资源需求、风险和验收标准。'
  };
  const instruction = templates[type] || templates.notice;
  return [
    instruction,
    '',
    '主题：' + topicText,
    '语气：' + toneText,
    '',
    '请直接输出可交付正文，不要解释你将如何写。'
  ].join('\n');
}

function buildChatMessages(settings, memory, skills, userText, explicitSkills) {
  const selected = selectSkills(skills, userText, explicitSkills);
  const skillPrompt = selected.map((skill) => skill.prompt).join('\n\n');
  const trimmed = trimMemory(memory, settings.maxMemoryMessages || 40, settings.maxContextItems || 12);
  const system = buildSystemPrompt(skillPrompt, contextToParts(trimmed.context));
  return [{ role: 'system', content: system }]
    .concat(trimmed.messages || [])
    .concat([{ role: 'user', content: String(userText || '') }]);
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  resolveModel,
  hasCommandPrefix,
  splitCommandSegments,
  validateCommand,
  requiresConfirmation,
  parseSkillMarkdown,
  selectSkills,
  parseReferences,
  normalizeWorkspacePath,
  shouldIncludeWorkspaceFile,
  shouldTraverseWorkspaceDir,
  buildWorkspaceContext,
  extractFileChangePlan,
  applyTextChange,
  buildRollbackSnapshot,
  splitAssistantContent,
  resolveWorkSettings,
  shouldContinueWork,
  createAbortHandle,
  abortError,
  isAbortError,
  recordEscPress,
  cleanSessionTitle,
  ensureSessionIndex,
  addSession,
  setActiveSession,
  renameSession,
  deleteSession,
  formatCommandResult,
  formatToolResults,
  appendWorkTurn,
  conversationHistory,
  withApiKeyHeader,
  extractHtml,
  trimMemory,
  contextToParts,
  buildSystemPrompt,
  buildDraftPrompt,
  buildChatMessages
};
