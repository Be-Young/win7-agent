'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const childProcess = require('child_process');
const core = require('./lib/core');

let output;

function activate(context) {
  output = vscode.window.createOutputChannel('Win7 Agent');
  context.subscriptions.push(output);

  register(context, 'win7Agent.openChat', openChat);
  register(context, 'win7Agent.askSelection', askSelection);
  register(context, 'win7Agent.readUrl', readUrlIntoContext);
  register(context, 'win7Agent.readFile', readFileIntoContext);
  register(context, 'win7Agent.draftDocument', draftDocument);
  register(context, 'win7Agent.switchModel', switchModel);
  register(context, 'win7Agent.runCommand', runCommandFromInput);
  register(context, 'win7Agent.showMemory', showMemory);
  register(context, 'win7Agent.clearMemory', clearMemoryCommand);
  register(context, 'win7Agent.openManual', openManual);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(comment-discussion) Win7 Agent';
  status.tooltip = 'Open Win7 Agent chat';
  status.command = 'win7Agent.openChat';
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {}

function register(context, command, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(command, () => {
    return Promise.resolve(handler(context)).catch((err) => {
      const message = err && err.message ? err.message : String(err);
      output.appendLine('[error] ' + message);
      vscode.window.showErrorMessage(message);
    });
  }));
}

function getSettings() {
  const cfg = vscode.workspace.getConfiguration('win7Agent');
  const settings = {
    baseUrl: cfg.get('baseUrl') || core.DEFAULT_BASE_URL,
    model: cfg.get('model') || core.DEFAULT_MODEL,
    activeModel: cfg.get('activeModel') || '',
    models: cfg.get('models') || {},
    apiKey: cfg.get('apiKey') || '',
    stream: cfg.get('stream') === true,
    headers: cfg.get('headers') || {},
    caFile: cfg.get('caFile') || '',
    insecureSkipVerify: cfg.get('insecureSkipVerify') === true,
    authProfiles: cfg.get('authProfiles') || {},
    skillsPaths: cfg.get('skillsPaths') || ['skills'],
    maxContentChars: cfg.get('maxContentChars') || 120000,
    timeoutSeconds: cfg.get('timeoutSeconds') || 120,
    agentExePath: cfg.get('agentExePath') || '',
    reuseBundledAgentExe: cfg.get('reuseBundledAgentExe') !== false,
    command: {
      enabled: cfg.get('command.enabled') !== false,
      confirmPrefixes: cfg.get('command.confirmPrefixes') || defaultConfirmPrefixes(),
      blockedPrefixes: cfg.get('command.blockedPrefixes') || [],
      alwaysConfirm: cfg.get('command.alwaysConfirm') === true,
      maxOutputBytes: cfg.get('command.maxOutputBytes') || 65536
    },
    memory: {
      enabled: cfg.get('memory.enabled') !== false,
      maxMessages: cfg.get('memory.maxMessages') || 40,
      maxContextItems: cfg.get('memory.maxContextItems') || 12
    }
  };
  const resolved = core.resolveModel(settings);
  return Object.assign(settings, resolved, {
    maxMemoryMessages: settings.memory.maxMessages,
    maxContextItems: settings.memory.maxContextItems
  });
}

function defaultConfirmPrefixes() {
  return ['del', 'erase', 'format', 'reg', 'net', 'netsh', 'powershell', 'wmic', 'shutdown', 'sc', 'takeown', 'icacls', 'diskpart', 'cipher'];
}

async function openChat(context) {
  const panel = vscode.window.createWebviewPanel(
    'win7AgentChat',
    'Win7 Agent',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = chatHtml(panel.webview);
  panel.webview.onDidReceiveMessage((message) => handlePanelMessage(context, panel, message), undefined, context.subscriptions);
}

async function handlePanelMessage(context, panel, message) {
  if (!message || !message.type) {
    return;
  }
  if (message.type === 'ready') {
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'send') {
    await sendPanelMessage(context, panel, message.text || '');
    return;
  }
  if (message.type === 'file') {
    await panelLoadFile(context, panel);
    return;
  }
  if (message.type === 'url') {
    await panelLoadUrl(context, panel);
    return;
  }
  if (message.type === 'model') {
    await switchModel(context);
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'clear') {
    await clearMemory(context);
    panel.webview.postMessage({ type: 'notice', text: 'Memory cleared.' });
    await postPanelState(context, panel);
  }
}

async function postPanelState(context, panel) {
  const settings = getSettings();
  const memory = await loadMemory(context);
  panel.webview.postMessage({
    type: 'state',
    model: settings.model,
    profile: settings.profileName,
    messages: memory.messages.length,
    contextItems: memory.context.length,
    stream: settings.stream
  });
}

async function sendPanelMessage(context, panel, text) {
  const userText = String(text || '').trim();
  if (!userText) {
    return;
  }
  const settings = getSettings();
  const memory = await loadMemory(context);
  const skills = loadSkills(context, settings);
  const explicit = explicitSkillNames(userText);
  const messages = core.buildChatMessages(settings, memory, skills, userText, explicit);
  panel.webview.postMessage({ type: 'append', role: 'user', text: userText });
  panel.webview.postMessage({ type: 'assistantStart' });
  const answer = await chatCompletion(settings, messages, (delta) => {
    panel.webview.postMessage({ type: 'assistantDelta', text: delta });
  });
  panel.webview.postMessage({ type: 'assistantDone', text: answer });

  memory.messages.push({ role: 'user', content: userText });
  memory.messages.push({ role: 'assistant', content: answer });
  await saveMemory(context, core.trimMemory(memory, settings.memory.maxMessages, settings.memory.maxContextItems));
  await postPanelState(context, panel);

  const action = extractAgentAction(answer);
  if (action && action.action === 'run_command' && action.command) {
    const commandText = String(action.command);
    const ok = await vscode.window.showInformationMessage('模型请求执行命令：' + commandText, { modal: true }, '运行', '取消');
    if (ok === '运行') {
      await runLocalCommand(context, commandText, true);
    }
  }
}

async function panelLoadFile(context, panel) {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Load as context' });
  if (!uris || uris.length === 0) {
    return;
  }
  const settings = getSettings();
  const content = await readLocalFile(context, uris[0].fsPath, settings);
  await addContextItem(context, 'file', uris[0].fsPath, content);
  panel.webview.postMessage({ type: 'notice', text: 'Loaded file: ' + uris[0].fsPath });
  await postPanelState(context, panel);
}

async function panelLoadUrl(context, panel) {
  const rawUrl = await vscode.window.showInputBox({ prompt: '输入内网页面 URL', placeHolder: 'http://intranet.example/page' });
  if (!rawUrl) {
    return;
  }
  const settings = getSettings();
  const page = await readUrl(rawUrl, settings);
  await addContextItem(context, 'url', rawUrl, pageToMarkdown(page));
  panel.webview.postMessage({ type: 'notice', text: 'Loaded URL: ' + rawUrl });
  await postPanelState(context, panel);
}

async function askSelection(context) {
  const editor = vscode.window.activeTextEditor;
  const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
  const question = await vscode.window.showInputBox({
    prompt: selection ? '询问当前选中文本' : '询问 Win7 Agent',
    placeHolder: '例如：总结重点、改写得更正式、指出风险'
  });
  if (!question) {
    return;
  }
  const settings = getSettings();
  const memory = await loadMemory(context);
  const oneShotMemory = {
    messages: memory.messages.slice(),
    context: memory.context.slice()
  };
  if (selection) {
    oneShotMemory.context.push({ kind: 'selection', source: editor.document.fileName || 'active editor', content: limit(selection, settings.maxContentChars) });
  }
  const skills = loadSkills(context, settings);
  const messages = core.buildChatMessages(settings, oneShotMemory, skills, question, explicitSkillNames(question));
  const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Win7 Agent is thinking...' }, () => chatCompletion(settings, messages));
  memory.messages.push({ role: 'user', content: question });
  memory.messages.push({ role: 'assistant', content: answer });
  await saveMemory(context, core.trimMemory(memory, settings.memory.maxMessages, settings.memory.maxContextItems));
  await openMarkdownDocument('# Win7 Agent Answer\n\n' + answer + '\n');
}

async function readUrlIntoContext(context) {
  const rawUrl = await vscode.window.showInputBox({ prompt: '输入内网页面 URL', placeHolder: 'http://intranet.example/page' });
  if (!rawUrl) {
    return;
  }
  const settings = getSettings();
  const page = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading intranet page...' }, () => readUrl(rawUrl, settings));
  const markdown = pageToMarkdown(page);
  await addContextItem(context, 'url', rawUrl, markdown);
  await openMarkdownDocument(markdown);
  vscode.window.showInformationMessage('URL 已加入上下文记忆。');
}

async function readFileIntoContext(context) {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Load as context' });
  if (!uris || uris.length === 0) {
    return;
  }
  const settings = getSettings();
  const content = await readLocalFile(context, uris[0].fsPath, settings);
  await addContextItem(context, 'file', uris[0].fsPath, content);
  vscode.window.showInformationMessage('文件已加入上下文记忆。');
}

async function draftDocument(context) {
  const type = await vscode.window.showQuickPick([
    { label: 'meeting', description: '会议纪要' },
    { label: 'email', description: '内部邮件' },
    { label: 'notice', description: '通知公告' },
    { label: 'report', description: '工作报告' },
    { label: 'summary', description: '摘要总结' },
    { label: 'proposal', description: '方案建议' }
  ], { placeHolder: '选择文档类型' });
  if (!type) {
    return;
  }
  const topic = await vscode.window.showInputBox({ prompt: '输入文档主题', placeHolder: '例如：研发周会、项目复盘、上线通知' });
  if (!topic) {
    return;
  }
  const tone = await vscode.window.showInputBox({ prompt: '输入语气要求', value: '正式、清晰、适合公司内部沟通' });
  if (!tone) {
    return;
  }
  const target = await vscode.window.showSaveDialog({
    saveLabel: 'Create',
    filters: {
      Documents: ['md', 'txt', 'csv', 'docx', 'xlsx']
    }
  });
  if (!target) {
    return;
  }
  if (fs.existsSync(target.fsPath)) {
    throw new Error('Refusing to overwrite existing file: ' + target.fsPath);
  }
  const settings = getSettings();
  const ext = path.extname(target.fsPath).toLowerCase();
  if ((ext === '.docx' || ext === '.xlsx') && findAgentExe(context, settings)) {
    await runAgentCli(context, ['doc', 'draft', '--type', type.label, '--out', target.fsPath, '--topic', topic, '--tone', tone], settings);
  } else if (ext === '.docx' || ext === '.xlsx') {
    throw new Error('生成 docx/xlsx 需要 VSIX 中的 agent.exe，或在设置里配置 win7Agent.agentExePath。');
  } else {
    const prompt = core.buildDraftPrompt(type.label, topic, tone);
    const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Drafting document...' }, () => {
      return chatCompletion(settings, [{ role: 'user', content: prompt }]);
    });
    fs.writeFileSync(target.fsPath, answer, 'utf8');
  }
  vscode.window.showInformationMessage('文档已生成：' + target.fsPath);
  const doc = await vscode.workspace.openTextDocument(target.fsPath);
  vscode.window.showTextDocument(doc);
}

async function switchModel() {
  const cfg = vscode.workspace.getConfiguration('win7Agent');
  const models = cfg.get('models') || {};
  const picks = [{ label: 'default', description: cfg.get('model') || core.DEFAULT_MODEL }];
  Object.keys(models).sort().forEach((name) => {
    picks.push({ label: name, description: models[name].model || cfg.get('model') || core.DEFAULT_MODEL });
  });
  const pick = await vscode.window.showQuickPick(picks, { placeHolder: '选择模型 profile' });
  if (!pick) {
    return;
  }
  const value = pick.label === 'default' ? '' : pick.label;
  const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await cfg.update('activeModel', value, target);
  vscode.window.showInformationMessage('已切换模型：' + (value || 'default'));
}

async function runCommandFromInput(context) {
  const command = await vscode.window.showInputBox({ prompt: '输入要执行的本地命令', placeHolder: 'dir' });
  if (!command) {
    return;
  }
  await runLocalCommand(context, command, false);
}

async function runLocalCommand(context, command, fromModel) {
  const settings = getSettings();
  const validation = core.validateCommand(command, settings.command);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  if (settings.command.alwaysConfirm || core.requiresConfirmation(command, settings.command)) {
    const confirmed = await vscode.window.showWarningMessage('高危命令需要确认：' + command, { modal: true }, '运行', '取消');
    if (confirmed !== '运行') {
      throw new Error('command cancelled');
    }
  }
  const cwd = workspaceRoot() || context.globalStorageUri.fsPath;
  output.show(true);
  output.appendLine('');
  output.appendLine('$ ' + command);
  const result = await execShell(command, cwd, settings.command.maxOutputBytes);
  if (result.stdout) {
    output.appendLine(result.stdout);
  }
  if (result.stderr) {
    output.appendLine(result.stderr);
  }
  await auditCommand(context, command, result.error);
  if (result.error) {
    throw result.error;
  }
  if (!fromModel) {
    vscode.window.showInformationMessage('命令已执行，输出见 Win7 Agent 面板。');
  }
}

async function showMemory(context) {
  const memory = await loadMemory(context);
  const lines = [
    '# Win7 Agent Memory',
    '',
    '- Messages: ' + memory.messages.length,
    '- Context items: ' + memory.context.length,
    ''
  ];
  memory.context.forEach((item) => {
    lines.push('## ' + (item.kind || 'context') + ': ' + (item.source || ''));
    lines.push('');
    lines.push(limit(item.content || '', 2000));
    lines.push('');
  });
  await openMarkdownDocument(lines.join('\n'));
}

async function clearMemoryCommand(context) {
  await clearMemory(context);
  vscode.window.showInformationMessage('Win7 Agent memory cleared.');
}

async function openManual(context) {
  const candidates = [
    path.join(context.extensionPath, 'docs', 'user-manual-zh.md'),
    path.join(workspaceRoot() || '', 'docs', 'user-manual-zh.md')
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i] && fs.existsSync(candidates[i])) {
      const doc = await vscode.workspace.openTextDocument(candidates[i]);
      await vscode.window.showTextDocument(doc);
      return;
    }
  }
  await openMarkdownDocument('# Win7 Agent VS Code 使用手册\n\n未找到随包手册文件。');
}

function loadSkills(context, settings) {
  const roots = [];
  const extensionSkills = path.join(context.extensionPath, 'skills');
  if (fs.existsSync(extensionSkills)) {
    roots.push(extensionSkills);
  }
  const ws = workspaceRoot();
  (settings.skillsPaths || []).forEach((item) => {
    const candidate = path.isAbsolute(item) ? item : path.join(ws || context.extensionPath, item);
    if (fs.existsSync(candidate)) {
      roots.push(candidate);
    }
  });
  const seen = {};
  const skills = [];
  roots.forEach((root) => {
    findSkillFiles(root).forEach((file) => {
      const key = path.resolve(file).toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      const fallback = path.basename(path.dirname(file));
      const skill = core.parseSkillMarkdown(fs.readFileSync(file, 'utf8'), fallback);
      skill.path = file;
      skills.push(skill);
    });
  });
  return skills;
}

function findSkillFiles(root) {
  const out = [];
  walk(root, out);
  return out;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  entries.forEach((entry) => {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      return;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.toLowerCase() === 'skill.md') {
      out.push(full);
    }
  });
}

async function readLocalFile(context, filePath, settings) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.txt', '.md', '.csv', '.json', '.log'].indexOf(ext) >= 0) {
    return limit(fs.readFileSync(filePath, 'utf8'), settings.maxContentChars);
  }
  if ((ext === '.docx' || ext === '.xlsx') && findAgentExe(context, settings)) {
    const result = await runAgentCli(context, ['doc', 'read', filePath], settings);
    return limit(result.stdout, settings.maxContentChars);
  }
  throw new Error('Unsupported document type in extension: ' + ext + '. docx/xlsx require bundled or configured agent.exe.');
}

function readUrl(rawUrl, settings) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(rawUrl);
    const headers = Object.assign({ 'User-Agent': 'win7-agent-vscode/0.3.0' }, settings.headers || {});
    applyAuthProfiles(rawUrl, settings.authProfiles || {}, headers);
    const client = endpoint.protocol === 'https:' ? https : http;
    const req = client.request(endpoint, tlsOptions(settings, {
      method: 'GET',
      headers: headers,
      timeout: (settings.timeoutSeconds || 120) * 1000
    }), (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('web status ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      const max = Math.max(settings.maxContentChars || 120000, 1) * 4;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= max) {
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(core.extractHtml(body, rawUrl));
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function applyAuthProfiles(rawUrl, profiles, headers) {
  Object.keys(profiles || {}).forEach((name) => {
    const profile = profiles[name] || {};
    if (profile.match && rawUrl.indexOf(profile.match) < 0) {
      return;
    }
    Object.keys(profile.headers || {}).forEach((key) => {
      headers[key] = profile.headers[key];
    });
    if (profile.cookie) {
      headers.Cookie = profile.cookie;
    }
    if (profile.basicUsername || profile.basicPassword) {
      const pair = String(profile.basicUsername || '') + ':' + String(profile.basicPassword || '');
      headers.Authorization = 'Basic ' + Buffer.from(pair, 'utf8').toString('base64');
    }
  });
}

function pageToMarkdown(page) {
  const lines = [];
  if (page.title) {
    lines.push('# ' + page.title, '');
  }
  if (page.description) {
    lines.push('> ' + page.description, '');
  }
  lines.push('Source: ' + (page.url || ''), '', page.text || '');
  if (page.links && page.links.length > 0) {
    lines.push('', '## Links');
    page.links.forEach((link) => {
      lines.push('- ' + (link.text ? link.text + ': ' : '') + link.href);
    });
  }
  return lines.join('\n');
}

function chatCompletion(settings, messages, onDelta) {
  return new Promise((resolve, reject) => {
    const url = normalizeChatUrl(settings.baseUrl);
    const endpoint = new URL(url);
    const body = JSON.stringify({
      model: settings.model,
      messages: messages,
      stream: settings.stream === true
    });
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, settings.headers || {});
    if (settings.apiKey) {
      headers.Authorization = 'Bearer ' + settings.apiKey;
    }
    const client = endpoint.protocol === 'https:' ? https : http;
    const req = client.request(endpoint, tlsOptions(settings, {
      method: 'POST',
      headers: headers,
      timeout: (settings.timeoutSeconds || 120) * 1000
    }), (res) => {
      const chunks = [];
      let answer = '';
      let sseBuffer = '';
      res.on('data', (chunk) => {
        if (settings.stream) {
          sseBuffer += chunk.toString('utf8');
          const lines = sseBuffer.split(/\r?\n/);
          sseBuffer = lines.pop() || '';
          lines.forEach((line) => {
            const parsed = parseSseLine(line);
            if (!parsed || parsed.done) {
              return;
            }
            if (parsed.content) {
              answer += parsed.content;
              if (onDelta) {
                onDelta(parsed.content);
              }
            }
          });
        } else {
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const text = settings.stream ? answer : Buffer.concat(chunks).toString('utf8');
          reject(new Error('api status ' + res.statusCode + ': ' + text));
          return;
        }
        if (settings.stream) {
          resolve(answer);
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const content = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
          resolve(content || '');
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseSseLine(line) {
  const trimmed = String(line || '').trim();
  if (trimmed.indexOf('data:') !== 0) {
    return null;
  }
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') {
    return { done: true };
  }
  try {
    const data = JSON.parse(payload);
    const delta = data && data.choices && data.choices[0] ? data.choices[0].delta : null;
    return { content: delta && delta.content ? delta.content : '' };
  } catch (err) {
    return null;
  }
}

function normalizeChatUrl(baseUrl) {
  const raw = String(baseUrl || core.DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(raw)) {
    return raw;
  }
  if (/\/v1$/i.test(raw)) {
    return raw + '/chat/completions';
  }
  return raw;
}

async function loadMemory(context) {
  const settings = getSettings();
  if (!settings.memory.enabled) {
    return { messages: [], context: [] };
  }
  const file = memoryPath(context);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return core.trimMemory(data, settings.memory.maxMessages, settings.memory.maxContextItems);
  } catch (err) {
    return { messages: [], context: [] };
  }
}

async function saveMemory(context, memory) {
  const settings = getSettings();
  if (!settings.memory.enabled) {
    return;
  }
  ensureDir(path.dirname(memoryPath(context)));
  fs.writeFileSync(memoryPath(context), JSON.stringify(memory, null, 2), 'utf8');
}

async function clearMemory(context) {
  ensureDir(path.dirname(memoryPath(context)));
  fs.writeFileSync(memoryPath(context), JSON.stringify({ messages: [], context: [] }, null, 2), 'utf8');
}

async function addContextItem(context, kind, source, content) {
  const settings = getSettings();
  const memory = await loadMemory(context);
  memory.context.push({
    kind: kind,
    source: source,
    content: limit(content, settings.maxContentChars),
    createdAt: new Date().toISOString()
  });
  await saveMemory(context, core.trimMemory(memory, settings.memory.maxMessages, settings.memory.maxContextItems));
}

function memoryPath(context) {
  return path.join(context.globalStorageUri.fsPath, 'memory', 'default.json');
}

function findAgentExe(context, settings) {
  const candidates = [];
  if (settings.agentExePath) {
    candidates.push(settings.agentExePath);
  }
  if (settings.reuseBundledAgentExe !== false) {
    candidates.push(path.join(context.extensionPath, 'agent.exe'));
    candidates.push(path.join(context.extensionPath, 'bin', 'agent.exe'));
  }
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i] && fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return '';
}

async function runAgentCli(context, args, settings) {
  const exe = findAgentExe(context, settings);
  if (!exe) {
    throw new Error('agent.exe not found. Configure win7Agent.agentExePath or install the bundled VSIX.');
  }
  const cwd = ensureAgentRuntime(context, settings);
  return execFile(exe, args, cwd, settings.command.maxOutputBytes || 65536);
}

function ensureAgentRuntime(context, settings) {
  const root = path.join(context.globalStorageUri.fsPath, 'agent-runtime');
  ensureDir(path.join(root, 'config'));
  ensureDir(path.join(root, 'logs'));
  ensureDir(path.join(root, 'sessions'));
  const config = {
    base_url: settings.baseUrl,
    model: settings.model,
    active_model: settings.activeModel || '',
    models: convertModels(settings.models || {}),
    api_key: settings.apiKey || '',
    stream: settings.stream === true,
    timeout_seconds: settings.timeoutSeconds || 120,
    ca_file: settings.caFile || '',
    insecure_skip_verify: settings.insecureSkipVerify === true,
    headers: settings.headers || {},
    auth_profiles: settings.authProfiles || {},
    command: {
      enabled: settings.command.enabled !== false,
      confirm_prefixes: settings.command.confirmPrefixes || defaultConfirmPrefixes(),
      blocked_prefixes: settings.command.blockedPrefixes || [],
      always_confirm: settings.command.alwaysConfirm === true,
      audit_log: path.join('logs', 'commands.log'),
      max_output_bytes: settings.command.maxOutputBytes || 65536
    },
    memory: {
      enabled: settings.memory.enabled !== false,
      session_file: path.join('sessions', 'default.json'),
      max_messages: settings.memory.maxMessages || 40,
      max_context_items: settings.memory.maxContextItems || 12
    },
    max_content_chars: settings.maxContentChars || 120000
  };
  fs.writeFileSync(path.join(root, 'config', 'agent.json'), JSON.stringify(config, null, 2), 'utf8');
  return root;
}

function convertModels(models) {
  const out = {};
  Object.keys(models || {}).forEach((name) => {
    const profile = models[name] || {};
    out[name] = {
      base_url: profile.baseUrl || profile.base_url || '',
      model: profile.model || '',
      api_key: profile.apiKey || profile.api_key || '',
      stream: profile.stream,
      headers: profile.headers || {}
    };
  });
  return out;
}

function execShell(command, cwd, maxOutputBytes) {
  return new Promise((resolve) => {
    childProcess.exec(command, { cwd: cwd, windowsHide: true, maxBuffer: maxOutputBytes || 65536 }, (error, stdout, stderr) => {
      resolve({ error: error, stdout: limit(stdout || '', maxOutputBytes || 65536), stderr: limit(stderr || '', maxOutputBytes || 65536) });
    });
  });
}

function tlsOptions(settings, options) {
  const out = Object.assign({}, options);
  if (settings.insecureSkipVerify) {
    out.rejectUnauthorized = false;
  }
  if (settings.caFile) {
    try {
      out.ca = fs.readFileSync(settings.caFile);
    } catch (err) {
      output.appendLine('[warning] failed to read CA file: ' + err.message);
    }
  }
  return out;
}

function execFile(file, args, cwd, maxOutputBytes) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { cwd: cwd, windowsHide: true, maxBuffer: maxOutputBytes || 65536 }, (error, stdout, stderr) => {
      if (error) {
        error.message = error.message + (stderr ? '\n' + stderr : '');
        reject(error);
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function auditCommand(context, command, error) {
  const log = path.join(context.globalStorageUri.fsPath, 'logs', 'commands.log');
  ensureDir(path.dirname(log));
  const status = error ? error.message : 'ok';
  fs.appendFileSync(log, new Date().toISOString() + '\t' + status + '\t' + command + '\n', 'utf8');
}

function extractAgentAction(text) {
  const block = /```agent-action\s*([\s\S]*?)```/i.exec(text || '');
  const candidate = block ? block[1] : text;
  try {
    const parsed = JSON.parse(String(candidate || '').trim());
    return parsed && parsed.action ? parsed : null;
  } catch (err) {
    return null;
  }
}

function explicitSkillNames(text) {
  const matches = String(text || '').match(/@skill:([a-zA-Z0-9_-]+)/g) || [];
  return matches.map((item) => item.slice('@skill:'.length));
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : '';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function limit(text, max) {
  const value = String(text || '');
  if (!max || value.length <= max) {
    return value;
  }
  return value.slice(0, max) + '\n[content truncated]';
}

async function openMarkdownDocument(content) {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: content });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

function chatHtml(webview) {
  const nonce = String(Date.now());
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Win7 Agent</title>
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .wrap { display: flex; flex-direction: column; height: 100vh; }
    .bar { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .status { flex: 1; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 3px; padding: 5px 9px; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    #messages { flex: 1; overflow-y: auto; padding: 14px; }
    .msg { margin: 0 0 12px; padding: 10px 12px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-editor-inactiveSelectionBackground); white-space: pre-wrap; word-break: break-word; }
    .msg.user { border-left-color: var(--vscode-terminal-ansiGreen); }
    .msg.assistant { border-left-color: var(--vscode-terminal-ansiCyan); }
    .role { font-weight: 600; margin-bottom: 6px; opacity: 0.8; }
    .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--vscode-panel-border); }
    textarea { flex: 1; min-height: 70px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 8px; font-family: var(--vscode-font-family); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <div class="status" id="status">Win7 Agent</div>
      <button class="secondary" id="file">File</button>
      <button class="secondary" id="url">URL</button>
      <button class="secondary" id="model">Model</button>
      <button class="secondary" id="clear">Clear</button>
    </div>
    <div id="messages"></div>
    <div class="composer">
      <textarea id="input" placeholder="输入问题。Ctrl+Enter 发送；可用 @skill:report 指定 skill。"></textarea>
      <button id="send">Send</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    let streaming = null;

    function append(role, text) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      const title = document.createElement('div');
      title.className = 'role';
      title.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Win7 Agent' : 'System';
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = text || '';
      el.appendChild(title);
      el.appendChild(body);
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return body;
    }

    function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      vscode.postMessage({ type: 'send', text });
    }

    document.getElementById('send').addEventListener('click', send);
    document.getElementById('file').addEventListener('click', () => vscode.postMessage({ type: 'file' }));
    document.getElementById('url').addEventListener('click', () => vscode.postMessage({ type: 'url' }));
    document.getElementById('model').addEventListener('click', () => vscode.postMessage({ type: 'model' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        send();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'state') {
        document.getElementById('status').textContent = 'Model: ' + msg.model + ' / profile: ' + msg.profile + ' / memory: ' + msg.messages + ' messages, ' + msg.contextItems + ' context';
      } else if (msg.type === 'append') {
        append(msg.role, msg.text);
      } else if (msg.type === 'assistantStart') {
        streaming = append('assistant', '');
      } else if (msg.type === 'assistantDelta') {
        if (!streaming) streaming = append('assistant', '');
        streaming.textContent += msg.text || '';
        messages.scrollTop = messages.scrollHeight;
      } else if (msg.type === 'assistantDone') {
        if (streaming && !streaming.textContent) streaming.textContent = msg.text || '';
        streaming = null;
      } else if (msg.type === 'notice') {
        append('system', msg.text || '');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate
};
