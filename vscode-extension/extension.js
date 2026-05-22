'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const childProcess = require('child_process');
const core = require('./lib/core');

let output;
const panelStates = new WeakMap();

function activate(context) {
  output = vscode.window.createOutputChannel('Win7 Agent');
  context.subscriptions.push(output);

  register(context, 'win7Agent.openChat', openChat);
  register(context, 'win7Agent.askSelection', askSelection);
  register(context, 'win7Agent.readUrl', readUrlIntoContext);
  register(context, 'win7Agent.readFile', readFileIntoContext);
  register(context, 'win7Agent.readWorkspace', readWorkspaceIntoContext);
  register(context, 'win7Agent.draftDocument', draftDocument);
  register(context, 'win7Agent.switchModel', switchModel);
  register(context, 'win7Agent.runCommand', runCommandFromInput);
  register(context, 'win7Agent.rollbackLastChange', rollbackLastChange);
  register(context, 'win7Agent.referenceFile', referenceFileCommand);
  register(context, 'win7Agent.referenceSkill', referenceSkillCommand);
  register(context, 'win7Agent.newSession', newSessionCommand);
  register(context, 'win7Agent.switchSession', switchSessionCommand);
  register(context, 'win7Agent.deleteSession', deleteSessionCommand);
  register(context, 'win7Agent.renameSession', renameSessionCommand);
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
    },
    workspace: {
      maxFiles: cfg.get('workspace.maxFiles') || 300,
      maxFileBytes: cfg.get('workspace.maxFileBytes') || 200000,
      maxContextChars: cfg.get('workspace.maxContextChars') || 180000,
      excludeDirs: cfg.get('workspace.excludeDirs') || undefined,
      textExtensions: cfg.get('workspace.textExtensions') || undefined,
      includeInWorkMode: cfg.get('workspace.includeInWorkMode') !== false
    },
    work: {
      maxTurns: cfg.get('work.maxTurns') || 8,
      autoApplyFileChanges: cfg.get('work.autoApplyFileChanges') !== false
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
  panelStates.set(panel, { working: false, stopRequested: false, esc: {} });
  panel.webview.onDidReceiveMessage((message) => {
    handlePanelMessage(context, panel, message).catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      output.appendLine('[error] ' + msg);
      panel.webview.postMessage({ type: 'notice', text: 'Error: ' + msg });
      vscode.window.showErrorMessage(msg);
    });
  }, undefined, context.subscriptions);
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
    if (message.work) {
      await sendWorkMessage(context, panel, message.text || '');
    } else {
      await sendPanelMessage(context, panel, message.text || '');
    }
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
  if (message.type === 'workspace') {
    await panelLoadWorkspace(context, panel);
    return;
  }
  if (message.type === 'refFile') {
    await panelReferenceFile(context, panel);
    return;
  }
  if (message.type === 'refSkill') {
    await panelReferenceSkill(context, panel);
    return;
  }
  if (message.type === 'rollback') {
    await rollbackLastChange(context);
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'newSession') {
    await newSessionCommand(context);
    panel.webview.postMessage({ type: 'notice', text: 'New session created.' });
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'switchSession') {
    await switchSessionCommand(context);
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'renameSession') {
    await renameSessionCommand(context);
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'deleteSession') {
    await deleteSessionCommand(context);
    await postPanelState(context, panel);
    return;
  }
  if (message.type === 'esc') {
    const state = getPanelState(panel);
    state.esc = core.recordEscPress(state.esc, Date.now());
    if (state.esc.stop && state.working) {
      state.stopRequested = true;
      panel.webview.postMessage({ type: 'notice', text: 'Stop requested. Continuous work will stop after the current step.' });
    }
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
  const session = activeSessionMeta(context);
  panel.webview.postMessage({
    type: 'state',
    model: settings.model,
    profile: settings.profileName,
    sessionId: session.id,
    sessionTitle: session.title,
    messages: memory.messages.length,
    contextItems: memory.context.length,
    stream: settings.stream,
    working: getPanelState(panel).working
  });
}

async function sendPanelMessage(context, panel, text) {
  const userText = String(text || '').trim();
  if (!userText) {
    return;
  }
  const state = getPanelState(panel);
  if (state.working) {
    panel.webview.postMessage({ type: 'notice', text: 'Continuous work is running. Press Esc twice to stop it first.' });
    return;
  }
  const settings = getSettings();
  const memory = await loadMemory(context);
  const skills = loadSkills(context, settings);
  const prepared = await prepareMemoryForMessage(context, memory, settings, skills, userText);
  const messages = core.buildChatMessages(settings, prepared.memory, skills, userText, prepared.explicitSkills);
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

  await handleAssistantActions(context, panel, answer, { autoApplyFileChanges: false });
}

async function sendWorkMessage(context, panel, text) {
  const userText = String(text || '').trim();
  if (!userText) {
    return;
  }
  const state = getPanelState(panel);
  if (state.working) {
    panel.webview.postMessage({ type: 'notice', text: 'Continuous work is already running. Press Esc twice to stop.' });
    return;
  }
  state.working = true;
  state.stopRequested = false;
  state.esc = {};
  await postPanelState(context, panel);
  const settings = getSettings();
  const skills = loadSkills(context, settings);
  const memory = await loadMemory(context);
  const workMemory = {
    messages: memory.messages.slice(),
    context: memory.context.slice()
  };
  const prepared = await prepareMemoryForMessage(context, workMemory, settings, skills, userText);
  if (settings.workspace.includeInWorkMode && workspaceRoot()) {
    const workspaceContext = await buildWorkspaceContextFromDisk(settings);
    prepared.memory.context.push({ kind: 'workspace', source: workspaceRoot(), content: workspaceContext });
  }
  const workPrompt = [
    userText,
    '',
    'Continuous work mode is enabled. Work step by step until the task is complete.',
    'When you need to edit files, output an agent-files block. When the task is complete, answer without agent-files or agent-action blocks.'
  ].join('\n');
  let messages = core.buildChatMessages(settings, prepared.memory, skills, workPrompt, prepared.explicitSkills);
  panel.webview.postMessage({ type: 'append', role: 'user', text: userText + '\n\n[continuous work mode]' });
  try {
    for (let turn = 1; turn <= settings.work.maxTurns; turn += 1) {
      if (state.stopRequested) {
        panel.webview.postMessage({ type: 'notice', text: 'Continuous work stopped.' });
        break;
      }
      panel.webview.postMessage({ type: 'notice', text: 'Work step ' + turn + ' / ' + settings.work.maxTurns });
      panel.webview.postMessage({ type: 'assistantStart' });
      const answer = await chatCompletion(settings, messages, (delta) => {
        panel.webview.postMessage({ type: 'assistantDelta', text: delta });
      });
      panel.webview.postMessage({ type: 'assistantDone', text: answer });
      memory.messages.push({ role: 'user', content: turn === 1 ? userText : '[continuous work step ' + turn + ']' });
      memory.messages.push({ role: 'assistant', content: answer });
      await saveMemory(context, core.trimMemory(memory, settings.memory.maxMessages, settings.memory.maxContextItems));

      const results = await handleAssistantActions(context, panel, answer, {
        autoApplyFileChanges: settings.work.autoApplyFileChanges,
        collectResults: true
      });
      if (results.length === 0) {
        break;
      }
      messages = messages.concat([
        { role: 'assistant', content: answer },
        { role: 'user', content: 'Tool results:\n' + results.join('\n\n') + '\n\nContinue working. If the task is complete, provide a concise final summary without tool blocks.' }
      ]);
    }
  } finally {
    state.working = false;
    state.stopRequested = false;
    await postPanelState(context, panel);
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

async function panelLoadWorkspace(context, panel) {
  const settings = getSettings();
  const workspaceContext = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading workspace files...' }, () => {
    return buildWorkspaceContextFromDisk(settings);
  });
  await addContextItem(context, 'workspace', workspaceRoot(), workspaceContext);
  panel.webview.postMessage({ type: 'notice', text: 'Loaded workspace into context.' });
  await postPanelState(context, panel);
}

async function panelReferenceFile(context, panel) {
  const picked = await pickWorkspaceFile(getSettings());
  if (!picked) {
    return;
  }
  panel.webview.postMessage({ type: 'insertText', text: '@file:' + picked + ' ' });
}

async function panelReferenceSkill(context, panel) {
  const picked = await pickSkill(context, getSettings());
  if (!picked) {
    return;
  }
  panel.webview.postMessage({ type: 'insertText', text: '@skill:' + picked + ' ' });
}

function getPanelState(panel) {
  let state = panelStates.get(panel);
  if (!state) {
    state = { working: false, stopRequested: false, esc: {} };
    panelStates.set(panel, state);
  }
  return state;
}

async function prepareMemoryForMessage(context, memory, settings, skills, userText) {
  const refs = core.parseReferences(userText);
  const prepared = {
    messages: memory.messages.slice(),
    context: memory.context.slice()
  };
  for (let i = 0; i < refs.files.length; i += 1) {
    const rel = refs.files[i];
    const absolute = safeWorkspacePath(rel);
    const content = await readLocalFile(context, absolute, settings);
    prepared.context.push({ kind: 'file-ref', source: rel, content: content });
  }
  const explicit = uniqueStrings(explicitSkillNames(userText).concat(refs.skills));
  return { memory: prepared, explicitSkills: explicit };
}

async function handleAssistantActions(context, panel, answer, options) {
  const opts = options || {};
  const results = [];
  let plan = null;
  try {
    plan = core.extractFileChangePlan(answer);
  } catch (err) {
    panel.webview.postMessage({ type: 'notice', text: 'Invalid file change plan: ' + err.message });
  }
  if (plan) {
    let shouldApply = opts.autoApplyFileChanges === true;
    if (!shouldApply) {
      const confirm = await vscode.window.showInformationMessage('模型提出修改 ' + plan.changes.length + ' 个项目文件：' + (plan.summary || ''), { modal: true }, '应用并保存回退点', '取消');
      shouldApply = confirm === '应用并保存回退点';
    }
    if (shouldApply) {
      const result = await applyFileChangePlan(context, plan);
      panel.webview.postMessage({ type: 'notice', text: result.summary });
      results.push(result.summary);
    }
  }

  const action = extractAgentAction(answer);
  if (action && action.action === 'run_command' && action.command) {
    const commandText = String(action.command);
    const ok = opts.autoApplyFileChanges
      ? '运行'
      : await vscode.window.showInformationMessage('模型请求执行命令：' + commandText, { modal: true }, '运行', '取消');
    if (ok === '运行') {
      const commandResult = await runLocalCommand(context, commandText, true);
      results.push('Command executed: ' + commandText + '\n' + limit(commandResult.stdout || commandResult.stderr || '', 4000));
    }
  }
  return opts.collectResults ? results : [];
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
  const prepared = await prepareMemoryForMessage(context, oneShotMemory, settings, skills, question);
  const messages = core.buildChatMessages(settings, prepared.memory, skills, question, prepared.explicitSkills);
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

async function readWorkspaceIntoContext(context) {
  const settings = getSettings();
  const workspaceContext = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading workspace files...' }, () => {
    return buildWorkspaceContextFromDisk(settings);
  });
  await addContextItem(context, 'workspace', workspaceRoot(), workspaceContext);
  await openMarkdownDocument(workspaceContext);
  vscode.window.showInformationMessage('当前项目已加入上下文记忆。');
}

async function referenceFileCommand(context) {
  const picked = await pickWorkspaceFile(getSettings());
  if (!picked) {
    return;
  }
  const settings = getSettings();
  const content = await readLocalFile(context, safeWorkspacePath(picked), settings);
  await addContextItem(context, 'file-ref', picked, content);
  vscode.window.showInformationMessage('已引用文件：' + picked);
}

async function referenceSkillCommand(context) {
  const picked = await pickSkill(context, getSettings());
  if (!picked) {
    return;
  }
  await vscode.env.clipboard.writeText('@skill:' + picked);
  vscode.window.showInformationMessage('已复制 skill 引用：@skill:' + picked);
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
  return result;
}

async function rollbackLastChange(context) {
  const root = workspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const index = loadChangeIndex(context);
  if (index.length === 0) {
    vscode.window.showInformationMessage('没有可回退的 Win7 Agent 文件变更。');
    return;
  }
  const item = index[index.length - 1];
  const snapshot = loadChangeSnapshot(context, item.id);
  const files = (snapshot.files || []).slice().reverse();
  files.forEach((file) => {
    const target = safeWorkspacePath(file.path);
    if (file.originalExists) {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, file.originalContent || '', 'utf8');
    } else if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  });
  index.pop();
  saveChangeIndex(context, index);
  vscode.window.showInformationMessage('已回退变更：' + item.id);
}

async function newSessionCommand(context) {
  const title = await vscode.window.showInputBox({ prompt: '新会话标题', value: 'New Session' });
  if (title === undefined) {
    return;
  }
  const index = loadSessionIndex(context);
  const id = sessionId();
  const now = new Date().toISOString();
  saveSessionIndex(context, core.addSession(index, id, title || 'New Session', now));
  saveSessionData(context, id, { messages: [], context: [] });
  vscode.window.showInformationMessage('已新建会话：' + core.cleanSessionTitle(title || 'New Session'));
}

async function switchSessionCommand(context) {
  const index = loadSessionIndex(context);
  const picks = index.sessions.slice().reverse().map((session) => ({
    label: session.title,
    description: session.id === index.activeId ? 'current' : session.updatedAt,
    sessionId: session.id
  }));
  const picked = await vscode.window.showQuickPick(picks, { placeHolder: '选择历史会话' });
  if (!picked) {
    return;
  }
  saveSessionIndex(context, core.setActiveSession(index, picked.sessionId));
  vscode.window.showInformationMessage('已切换会话：' + picked.label);
}

async function deleteSessionCommand(context) {
  const index = loadSessionIndex(context);
  const picks = index.sessions.slice().reverse().map((session) => ({
    label: session.title,
    description: session.id === index.activeId ? 'current' : session.updatedAt,
    sessionId: session.id
  }));
  const picked = await vscode.window.showQuickPick(picks, { placeHolder: '选择要删除的历史会话' });
  if (!picked) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage('删除会话及其上下文：' + picked.label, { modal: true }, '删除', '取消');
  if (confirmed !== '删除') {
    return;
  }
  let next = core.deleteSession(index, picked.sessionId);
  const dataPath = sessionDataPath(context, picked.sessionId);
  if (fs.existsSync(dataPath)) {
    fs.unlinkSync(dataPath);
  }
  if (next.sessions.length === 0) {
    const id = sessionId();
    const now = new Date().toISOString();
    next = core.addSession(next, id, 'New Session', now);
    saveSessionData(context, id, { messages: [], context: [] });
  }
  saveSessionIndex(context, next);
  vscode.window.showInformationMessage('已删除会话：' + picked.label);
}

async function renameSessionCommand(context) {
  const index = loadSessionIndex(context);
  const current = index.sessions.find((item) => item.id === index.activeId);
  if (!current) {
    return;
  }
  const title = await vscode.window.showInputBox({ prompt: '修改当前会话标题', value: current.title });
  if (title === undefined) {
    return;
  }
  saveSessionIndex(context, core.renameSession(index, current.id, title));
  vscode.window.showInformationMessage('已修改会话标题：' + core.cleanSessionTitle(title));
}

async function showMemory(context) {
  const memory = await loadMemory(context);
  const session = activeSessionMeta(context);
  const lines = [
    '# Win7 Agent Memory',
    '',
    '- Session: ' + session.title,
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

async function buildWorkspaceContextFromDisk(settings) {
  const files = scanWorkspaceFiles(settings);
  return core.buildWorkspaceContext(files, { maxChars: settings.workspace.maxContextChars || settings.maxContentChars });
}

function scanWorkspaceFiles(settings) {
  const root = workspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const opts = {
    excludeDirs: settings.workspace.excludeDirs,
    textExtensions: settings.workspace.textExtensions,
    maxFileBytes: settings.workspace.maxFileBytes
  };
  const files = [];
  scanDir(root, root, opts, settings.workspace.maxFiles || 300, files);
  return files;
}

function scanDir(root, dir, opts, maxFiles, out) {
  if (out.length >= maxFiles) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  entries.sort().forEach((entry) => {
    if (out.length >= maxFiles) {
      return;
    }
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      return;
    }
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (stat.isDirectory()) {
      if (core.shouldIncludeWorkspaceFile(rel + '/placeholder.md', 0, opts)) {
        scanDir(root, full, opts, maxFiles, out);
      }
      return;
    }
    if (!stat.isFile() || !core.shouldIncludeWorkspaceFile(rel, stat.size, opts)) {
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

async function pickWorkspaceFile(settings) {
  const files = scanWorkspaceFiles(settings).map((file) => file.path);
  if (files.length === 0) {
    vscode.window.showInformationMessage('当前项目里没有可引用的文本文件。');
    return '';
  }
  return vscode.window.showQuickPick(files, { placeHolder: '选择要引用的项目文件' });
}

async function pickSkill(context, settings) {
  const skills = loadSkills(context, settings);
  if (skills.length === 0) {
    vscode.window.showInformationMessage('没有找到可用 skill。');
    return '';
  }
  const picks = skills.map((skill) => ({ label: skill.name, description: skill.description }));
  const picked = await vscode.window.showQuickPick(picks, { placeHolder: '选择要引用的 skill' });
  return picked ? picked.label : '';
}

async function applyFileChangePlan(context, plan) {
  const root = workspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const originals = {};
  plan.changes.forEach((change) => {
    const rel = core.normalizeWorkspacePath(change.path);
    const target = safeWorkspacePath(rel);
    originals[rel] = {
      exists: fs.existsSync(target),
      content: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
    };
  });
  const id = changeId();
  const snapshot = core.buildRollbackSnapshot(id, plan.changes, originals);
  plan.changes.forEach((change) => {
    const rel = core.normalizeWorkspacePath(change.path);
    const target = safeWorkspacePath(rel);
    const exists = fs.existsSync(target);
    if (change.action === 'create' && exists) {
      throw new Error('Refusing to create over existing file: ' + rel);
    }
    if ((change.action === 'replace' || change.action === 'delete') && !exists) {
      throw new Error('File does not exist: ' + rel);
    }
    if (change.action === 'replace') {
      core.applyTextChange(fs.readFileSync(target, 'utf8'), change);
    }
  });
  saveChangeSnapshot(context, snapshot, plan.summary || '');
  plan.changes.forEach((change) => {
    const rel = core.normalizeWorkspacePath(change.path);
    const target = safeWorkspacePath(rel);
    const exists = fs.existsSync(target);
    const current = exists ? fs.readFileSync(target, 'utf8') : '';
    const next = core.applyTextChange(current, change);
    if (next === null) {
      fs.unlinkSync(target);
    } else {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, next, 'utf8');
    }
  });
  return {
    id: id,
    summary: 'Applied ' + plan.changes.length + ' file change(s). Rollback id: ' + id
  };
}

function safeWorkspacePath(relativePath) {
  const root = workspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const rel = core.normalizeWorkspacePath(relativePath);
  const target = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (target !== rootResolved && target.indexOf(prefix) !== 0) {
    throw new Error('path outside workspace is not allowed: ' + relativePath);
  }
  return target;
}

function changeId() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(16).slice(2, 8);
}

function saveChangeSnapshot(context, snapshot, summary) {
  ensureDir(changeDir(context));
  fs.writeFileSync(changeSnapshotPath(context, snapshot.id), JSON.stringify(snapshot, null, 2), 'utf8');
  const index = loadChangeIndex(context);
  index.push({ id: snapshot.id, summary: summary || '', createdAt: snapshot.createdAt });
  saveChangeIndex(context, index);
}

function loadChangeSnapshot(context, id) {
  return JSON.parse(fs.readFileSync(changeSnapshotPath(context, id), 'utf8'));
}

function loadChangeIndex(context) {
  try {
    const data = JSON.parse(fs.readFileSync(changeIndexPath(context), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function saveChangeIndex(context, index) {
  ensureDir(changeDir(context));
  fs.writeFileSync(changeIndexPath(context), JSON.stringify(index, null, 2), 'utf8');
}

function changeDir(context) {
  return path.join(context.globalStorageUri.fsPath, 'changes');
}

function changeIndexPath(context) {
  return path.join(changeDir(context), 'index.json');
}

function changeSnapshotPath(context, id) {
  return path.join(changeDir(context), id + '.json');
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
  const root = workspaceRoot();
  if (root) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    if (rel && rel.indexOf('..') !== 0 && !path.isAbsolute(rel)) {
      const stat = fs.statSync(filePath);
      if (core.shouldIncludeWorkspaceFile(rel, stat.size, {
        excludeDirs: settings.workspace.excludeDirs,
        textExtensions: settings.workspace.textExtensions,
        maxFileBytes: settings.workspace.maxFileBytes
      })) {
        return limit(fs.readFileSync(filePath, 'utf8'), settings.maxContentChars);
      }
    }
  }
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
    const headers = Object.assign({ 'User-Agent': 'win7-agent-vscode/0.4.1' }, settings.headers || {});
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
  const session = activeSessionMeta(context);
  const file = sessionDataPath(context, session.id);
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
  const index = loadSessionIndex(context);
  const active = index.activeId;
  saveSessionData(context, active, memory);
  index.sessions = index.sessions.map((session) => {
    if (session.id !== active) {
      return session;
    }
    const copy = Object.assign({}, session);
    copy.updatedAt = new Date().toISOString();
    if (copy.title === 'New Session') {
      const firstUser = (memory.messages || []).find((item) => item.role === 'user' && item.content);
      if (firstUser) {
        copy.title = core.cleanSessionTitle(firstUser.content);
      }
    }
    return copy;
  });
  saveSessionIndex(context, index);
}

async function clearMemory(context) {
  const session = activeSessionMeta(context);
  saveSessionData(context, session.id, { messages: [], context: [] });
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

function legacyMemoryPath(context) {
  return path.join(context.globalStorageUri.fsPath, 'memory', 'default.json');
}

function activeSessionMeta(context) {
  const index = loadSessionIndex(context);
  const active = index.sessions.find((item) => item.id === index.activeId);
  return active || index.sessions[0];
}

function loadSessionIndex(context) {
  ensureDir(sessionDir(context));
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(sessionIndexPath(context), 'utf8'));
  } catch (err) {
    raw = null;
  }
  if (raw) {
    const index = core.ensureSessionIndex(raw, sessionId(), 'New Session', new Date().toISOString());
    if (!raw.activeId || !raw.sessions) {
      saveSessionIndex(context, index);
    }
    return index;
  }
  const id = sessionId();
  const now = new Date().toISOString();
  const index = core.ensureSessionIndex(null, id, 'New Session', now);
  const legacy = loadLegacyMemory(context);
  saveSessionData(context, id, legacy);
  saveSessionIndex(context, index);
  return index;
}

function saveSessionIndex(context, index) {
  ensureDir(sessionDir(context));
  fs.writeFileSync(sessionIndexPath(context), JSON.stringify(index, null, 2), 'utf8');
}

function loadLegacyMemory(context) {
  try {
    const data = JSON.parse(fs.readFileSync(legacyMemoryPath(context), 'utf8'));
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      context: Array.isArray(data.context) ? data.context : []
    };
  } catch (err) {
    return { messages: [], context: [] };
  }
}

function saveSessionData(context, id, data) {
  ensureDir(sessionDir(context));
  fs.writeFileSync(sessionDataPath(context, id), JSON.stringify(data || { messages: [], context: [] }, null, 2), 'utf8');
}

function sessionDir(context) {
  return path.join(context.globalStorageUri.fsPath, 'sessions');
}

function sessionIndexPath(context) {
  return path.join(sessionDir(context), 'index.json');
}

function sessionDataPath(context, id) {
  return path.join(sessionDir(context), id + '.json');
}

function sessionId() {
  return 's-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(16).slice(2, 8);
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
  return core.parseReferences(text).skills;
}

function uniqueStrings(values) {
  const seen = {};
  const out = [];
  (values || []).forEach((value) => {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen[key]) {
      return;
    }
    seen[key] = true;
    out.push(text);
  });
  return out;
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
    .bar { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-wrap: wrap; }
    .status { flex: 1; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 3px; padding: 5px 9px; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.active { outline: 1px solid var(--vscode-focusBorder); }
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
      <button class="secondary" id="project">Project</button>
      <button class="secondary" id="refFile">Ref File</button>
      <button class="secondary" id="skill">Skill</button>
      <button class="secondary" id="url">URL</button>
      <button class="secondary" id="model">Model</button>
      <button class="secondary" id="newSession">New</button>
      <button class="secondary" id="sessions">Sessions</button>
      <button class="secondary" id="renameSession">Rename</button>
      <button class="secondary" id="deleteSession">Delete</button>
      <button class="secondary" id="rollback">Rollback</button>
      <button class="secondary" id="clear">Clear</button>
    </div>
    <div id="messages"></div>
    <div class="composer">
      <textarea id="input" placeholder="输入问题。Ctrl+Enter 发送；可用 @file:src/app.js 引用文件，@skill:report 引用 skill。连续工作时连按两次 Esc 停止。"></textarea>
      <button class="secondary" id="work">Work</button>
      <button id="send">Send</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const workButton = document.getElementById('work');
    let streaming = null;
    let workMode = false;

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
      vscode.postMessage({ type: 'send', text, work: workMode });
    }

    document.getElementById('send').addEventListener('click', send);
    document.getElementById('file').addEventListener('click', () => vscode.postMessage({ type: 'file' }));
    document.getElementById('project').addEventListener('click', () => vscode.postMessage({ type: 'workspace' }));
    document.getElementById('refFile').addEventListener('click', () => vscode.postMessage({ type: 'refFile' }));
    document.getElementById('skill').addEventListener('click', () => vscode.postMessage({ type: 'refSkill' }));
    document.getElementById('url').addEventListener('click', () => vscode.postMessage({ type: 'url' }));
    document.getElementById('model').addEventListener('click', () => vscode.postMessage({ type: 'model' }));
    document.getElementById('newSession').addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
    document.getElementById('sessions').addEventListener('click', () => vscode.postMessage({ type: 'switchSession' }));
    document.getElementById('renameSession').addEventListener('click', () => vscode.postMessage({ type: 'renameSession' }));
    document.getElementById('deleteSession').addEventListener('click', () => vscode.postMessage({ type: 'deleteSession' }));
    document.getElementById('rollback').addEventListener('click', () => vscode.postMessage({ type: 'rollback' }));
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    workButton.addEventListener('click', () => {
      workMode = !workMode;
      workButton.className = workMode ? 'active' : 'secondary';
      workButton.textContent = workMode ? 'Work On' : 'Work';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        send();
      } else if (event.key === 'Escape') {
        vscode.postMessage({ type: 'esc' });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'state') {
        document.getElementById('status').textContent = 'Session: ' + msg.sessionTitle + ' / Model: ' + msg.model + ' / memory: ' + msg.messages + ' messages, ' + msg.contextItems + ' context' + (msg.working ? ' / working' : '');
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
      } else if (msg.type === 'insertText') {
        input.value = input.value + (msg.text || '');
        input.focus();
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
