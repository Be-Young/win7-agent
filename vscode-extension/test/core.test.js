const assert = require('assert');
const test = require('node:test');

const core = require('../lib/core');

test('resolveModel merges the active profile over global settings', () => {
  const resolved = core.resolveModel({
    baseUrl: 'http://default/v1/chat/completions',
    model: 'default-model',
    apiKey: 'default-key',
    stream: false,
    activeModel: 'fast',
    headers: { 'X-Global': '1', Authorization: 'Bearer default' },
    models: {
      fast: {
        baseUrl: 'http://fast/v1/chat/completions',
        model: 'fast-model',
        stream: true,
        headers: { Authorization: 'Bearer fast', 'X-Fast': '1' }
      }
    }
  });

  assert.equal(resolved.profileName, 'fast');
  assert.equal(resolved.baseUrl, 'http://fast/v1/chat/completions');
  assert.equal(resolved.model, 'fast-model');
  assert.equal(resolved.apiKey, 'default-key');
  assert.equal(resolved.stream, true);
  assert.deepEqual(resolved.headers, {
    'X-Global': '1',
    Authorization: 'Bearer fast',
    'X-Fast': '1'
  });
});

test('resolveModel lets a profile explicitly clear an inherited API key', () => {
  const resolved = core.resolveModel({
    apiKey: 'global-secret',
    activeModel: 'anonymous',
    models: { anonymous: { model: 'local', apiKey: '' } }
  });

  assert.equal(resolved.apiKey, '');
});

test('command policy blocks explicit blocked prefixes and confirms high risk prefixes', () => {
  const policy = {
    enabled: true,
    blockedPrefixes: ['format'],
    confirmPrefixes: ['del', 'reg', 'powershell']
  };

  assert.equal(core.validateCommand('dir C:\\temp', policy).ok, true);
  assert.equal(core.validateCommand('format C:', policy).ok, false);
  assert.equal(core.requiresConfirmation('DEL C:\\temp\\a.txt', policy), true);
  assert.equal(core.requiresConfirmation('reg query HKCU', policy), true);
  assert.equal(core.requiresConfirmation('powershell.exe Get-Process', policy), true);
  assert.equal(core.requiresConfirmation('type notes.txt', policy), false);
});

test('command policy inspects compound commands without matching quoted text', () => {
  const policy = {
    enabled: true,
    blockedPrefixes: ['format'],
    confirmPrefixes: ['del', 'powershell']
  };

  assert.equal(core.validateCommand('echo ready && format C:', policy).ok, false);
  assert.equal(core.requiresConfirmation('dir | powershell.exe Get-Process', policy), true);
  assert.equal(core.requiresConfirmation('echo "del important.txt"', policy), false);
  assert.equal(core.requiresConfirmation("echo 'safe & del important.txt'", policy), true);
  assert.equal(core.requiresConfirmation('cmd.exe /d /c "echo ready & del important.txt"', policy), true);
  assert.equal(core.validateCommand('cmd /c format C:', policy).ok, false);
  assert.equal(core.requiresConfirmation('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile', policy), true);
});

test('parseSkillMarkdown extracts front matter and leaves prompt body clean', () => {
  const skill = core.parseSkillMarkdown(`---
name: meeting
description: 会议纪要和行动项
keywords: 会议,纪要,行动项
---

# Meeting Skill

请输出结论、风险和行动项。
`, 'fallback');

  assert.equal(skill.name, 'meeting');
  assert.equal(skill.description, '会议纪要和行动项');
  assert.deepEqual(skill.keywords, ['会议', '纪要', '行动项']);
  assert.match(skill.prompt, /请输出结论/);
  assert.doesNotMatch(skill.prompt, /keywords:/);
});

test('selectSkills returns explicit names first and keyword matches otherwise', () => {
  const skills = [
    { name: 'email', description: '邮件沟通', keywords: ['邮件'], prompt: 'email prompt' },
    { name: 'report', description: '周报月报', keywords: ['周报', '汇报'], prompt: 'report prompt' }
  ];

  assert.deepEqual(core.selectSkills(skills, '帮我写周报', []).map((s) => s.name), ['report']);
  assert.deepEqual(core.selectSkills(skills, '随便聊聊', ['email']).map((s) => s.name), ['email']);
});

test('extractHtml prefers article content, converts tables, removes noise, and resolves links', () => {
  const page = core.extractHtml(`<!doctype html>
<html>
<head>
  <title>内网公告</title>
  <meta name="description" content="五月通知">
</head>
<body>
  <nav>不要出现的导航</nav>
  <article>
    <h1>通知标题</h1>
    <p>正文第一段。</p>
    <table><tr><th>姓名</th><th>任务</th></tr><tr><td>张三</td><td>提交材料</td></tr></table>
    <a href="/detail">详情</a>
  </article>
  <footer>不要出现的页脚</footer>
</body>
</html>`, 'http://intra.example/news/index.html');

  assert.equal(page.title, '内网公告');
  assert.equal(page.description, '五月通知');
  assert.match(page.text, /通知标题/);
  assert.match(page.text, /姓名 \| 任务/);
  assert.doesNotMatch(page.text, /不要出现/);
  assert.deepEqual(page.links, [{ text: '详情', href: 'http://intra.example/detail' }]);
});

test('trimMemory keeps the newest messages and context items', () => {
  const memory = {
    messages: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' }
    ],
    context: [
      { kind: 'file', source: 'a.txt', content: 'a' },
      { kind: 'url', source: 'b', content: 'b' },
      { kind: 'file', source: 'c.txt', content: 'c' }
    ]
  };

  const trimmed = core.trimMemory(memory, 2, 1);
  assert.deepEqual(trimmed.messages.map((m) => m.content), ['two', 'three']);
  assert.deepEqual(trimmed.context.map((c) => c.source), ['c.txt']);
});

test('buildDraftPrompt creates office-ready prompts for common document types', () => {
  const prompt = core.buildDraftPrompt('meeting', '研发周会', '简洁正式');

  assert.match(prompt, /研发周会/);
  assert.match(prompt, /会议纪要/);
  assert.match(prompt, /行动项/);
  assert.match(prompt, /简洁正式/);
});

test('buildSystemPrompt tells the model how to request local command execution', () => {
  const prompt = core.buildSystemPrompt('', []);

  assert.match(prompt, /agent-action/);
  assert.match(prompt, /run_command/);
  assert.match(prompt, /Ordinary local commands are allowed/);
});

test('parseReferences finds file and skill references in chat text', () => {
  const refs = core.parseReferences('请参考 @file:src/app.js 和 [[docs/readme.md]]，用 @skill:report #skill:meeting 处理。');

  assert.deepEqual(refs.files, ['src/app.js', 'docs/readme.md']);
  assert.deepEqual(refs.skills, ['report', 'meeting']);
});

test('normalizeWorkspacePath accepts relative project paths and rejects escapes', () => {
  assert.equal(core.normalizeWorkspacePath('.\\src\\app.js'), 'src/app.js');
  assert.equal(core.normalizeWorkspacePath('docs/readme.md'), 'docs/readme.md');
  assert.throws(() => core.normalizeWorkspacePath('../secret.txt'), /outside workspace/);
  assert.throws(() => core.normalizeWorkspacePath('C:\\Windows\\win.ini'), /absolute path/);
});

test('shouldIncludeWorkspaceFile skips excluded, binary, and oversized files', () => {
  const opts = {
    excludeDirs: ['.git', 'node_modules', 'dist'],
    textExtensions: ['.js', '.md', '.json'],
    maxFileBytes: 100
  };

  assert.equal(core.shouldIncludeWorkspaceFile('src/app.js', 80, opts), true);
  assert.equal(core.shouldIncludeWorkspaceFile('node_modules/lib/index.js', 10, opts), false);
  assert.equal(core.shouldIncludeWorkspaceFile('src/logo.png', 10, opts), false);
  assert.equal(core.shouldIncludeWorkspaceFile('src/large.js', 101, opts), false);
});

test('workspace directory traversal does not depend on configured file extensions', () => {
  const opts = { excludeDirs: ['node_modules'], textExtensions: ['.js'] };

  assert.equal(core.shouldTraverseWorkspaceDir('src/components', opts), true);
  assert.equal(core.shouldTraverseWorkspaceDir('src/node_modules/pkg', opts), false);
});

test('buildWorkspaceContext renders a tree and selected file contents within budget', () => {
  const context = core.buildWorkspaceContext([
    { path: 'README.md', content: '# Title\n', bytes: 8 },
    { path: 'src/app.js', content: 'console.log("hi");\n', bytes: 19 }
  ], { maxChars: 200 });

  assert.match(context, /Workspace file tree/);
  assert.match(context, /README.md/);
  assert.match(context, /src\/app.js/);
  assert.match(context, /console\.log/);
});

test('extractFileChangePlan parses agent-files blocks and validates paths', () => {
  const plan = core.extractFileChangePlan(`说明
\`\`\`agent-files
{
  "summary": "update app",
  "changes": [
    {"action": "write", "path": "src/app.js", "content": "console.log(1);"},
    {"action": "replace", "path": "README.md", "find": "old", "replace": "new"}
  ]
}
\`\`\`
`);

  assert.equal(plan.summary, 'update app');
  assert.deepEqual(plan.changes.map((change) => change.path), ['src/app.js', 'README.md']);
  assert.equal(plan.changes[1].action, 'replace');
});

test('extractFileChangePlan rejects duplicate Windows file paths', () => {
  assert.throws(() => core.extractFileChangePlan(`
\`\`\`agent-files
{"changes":[
  {"action":"write","path":"src/App.js","content":"one"},
  {"action":"write","path":"src/app.js","content":"two"}
]}
\`\`\`
`), /duplicate file path/);
});

test('applyTextChange supports write and exact replace operations', () => {
  assert.equal(core.applyTextChange('', { action: 'write', content: 'new file' }), 'new file');
  assert.equal(core.applyTextChange('hello old world', { action: 'replace', find: 'old', replace: 'new' }), 'hello new world');
  assert.throws(() => core.applyTextChange('hello world', { action: 'replace', find: 'missing', replace: 'new' }), /find text not found/);
});

test('buildRollbackSnapshot records original file contents before changes', () => {
  const snapshot = core.buildRollbackSnapshot('change-1', [
    { action: 'write', path: 'src/app.js', content: 'new' },
    { action: 'create', path: 'src/new.js', content: 'new' }
  ], {
    'src/app.js': { exists: true, content: 'old' },
    'src/new.js': { exists: false, content: '' }
  });

  assert.equal(snapshot.id, 'change-1');
  assert.deepEqual(snapshot.files.map((file) => file.path), ['src/app.js', 'src/new.js']);
  assert.equal(snapshot.files[0].originalExists, true);
  assert.equal(snapshot.files[1].originalExists, false);
});

test('recordEscPress only stops continuous work on a quick double escape', () => {
  let state = core.recordEscPress({}, 1000);
  assert.equal(state.stop, false);
  state = core.recordEscPress(state, 2500);
  assert.equal(state.stop, false);
  state = core.recordEscPress(state, 3000);
  assert.equal(state.stop, true);
});

test('session helpers create, switch, rename, and delete isolated sessions', () => {
  let index = core.ensureSessionIndex(null, 's1', '第一会话', '2026-05-22T00:00:00.000Z');
  assert.equal(index.activeId, 's1');
  assert.equal(index.sessions[0].title, '第一会话');

  index = core.addSession(index, 's2', '第二会话', '2026-05-22T00:01:00.000Z');
  assert.equal(index.activeId, 's2');
  assert.deepEqual(index.sessions.map((item) => item.id), ['s1', 's2']);

  index = core.renameSession(index, 's2', '改名后的会话');
  assert.equal(index.sessions[1].title, '改名后的会话');

  index = core.setActiveSession(index, 's1');
  assert.equal(index.activeId, 's1');

  index = core.deleteSession(index, 's1');
  assert.equal(index.activeId, 's2');
  assert.deepEqual(index.sessions.map((item) => item.id), ['s2']);
});

test('cleanSessionTitle keeps titles short and non-empty', () => {
  assert.equal(core.cleanSessionTitle('  项目修复  '), '项目修复');
  assert.equal(core.cleanSessionTitle(''), 'New Session');
  assert.equal(core.cleanSessionTitle('a'.repeat(90)).length, 60);
});

test('formatCommandResult preserves stdout stderr and exit code for model feedback', () => {
  const text = core.formatCommandResult('dir', {
    stdout: 'file-a.txt\n',
    stderr: 'warning\n',
    exitCode: 1,
    error: { message: 'exit status 1' }
  }, 2000);

  assert.match(text, /Command: dir/);
  assert.match(text, /Exit code: 1/);
  assert.match(text, /file-a\.txt/);
  assert.match(text, /warning/);
  assert.match(text, /exit status 1/);
});

test('continuous work memory keeps real tool results instead of step placeholders', () => {
  let memory = core.appendWorkTurn({ messages: [], context: [] }, {
    userText: '修复测试',
    answer: '先运行测试',
    results: ['Command: npm test\nExit code: 0']
  });
  memory = core.appendWorkTurn(memory, { answer: '测试通过，已完成' });

  assert.deepEqual(memory.messages.map((item) => item.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(memory.messages[2].content, /^Tool results:/);
  assert.doesNotMatch(memory.messages[2].content, /continuous work step/);
});

test('conversationHistory restores assistant sections and labels tool results as system output', () => {
  const history = core.conversationHistory([
    { role: 'user', content: '开始' },
    { role: 'assistant', content: '完成\n```agent-action\n{"action":"run_command","command":"dir"}\n```' },
    { role: 'user', content: 'Tool results:\nCommand: dir' },
    { role: 'system', content: 'hidden' }
  ]);

  assert.deepEqual(history.map((item) => item.role), ['user', 'assistant', 'system']);
  assert.deepEqual(history[1].parts.map((part) => part.kind), ['answer', 'agent-action']);
});

test('withApiKeyHeader preserves an explicit Authorization header', () => {
  assert.deepEqual(core.withApiKeyHeader({ Authorization: 'Basic abc' }, 'token'), { Authorization: 'Basic abc' });
  assert.deepEqual(core.withApiKeyHeader({ authorization: 'Custom abc' }, 'token'), { authorization: 'Custom abc' });
  assert.deepEqual(core.withApiKeyHeader({ 'X-Test': '1' }, 'token'), {
    'X-Test': '1',
    Authorization: 'Bearer token'
  });
});

test('splitAssistantContent separates final answer from folded think and tool blocks', () => {
  const parts = core.splitAssistantContent(`开头说明
<think>
内部推理
</think>
正式结论第一段。
\`\`\`agent-action
{"action":"run_command","command":"dir"}
\`\`\`
继续说明。
\`\`\`agent-files
{"summary":"write","changes":[{"action":"write","path":"a.txt","content":"a"}]}
\`\`\`
`);

  assert.deepEqual(parts.map((part) => part.kind), ['answer', 'think', 'agent-action', 'agent-files']);
  assert.match(parts[0].content, /正式结论第一段/);
  assert.match(parts[0].content, /继续说明/);
  assert.doesNotMatch(parts[0].content, /内部推理/);
  assert.equal(parts[1].collapsed, true);
  assert.equal(parts[2].collapsed, true);
  assert.equal(parts[3].collapsed, true);
});

test('work settings default to always-on continuous work with unlimited turns', () => {
  const work = core.resolveWorkSettings({});

  assert.equal(work.maxTurns, 0);
  assert.equal(work.autoApplyFileChanges, true);
  assert.equal(core.shouldContinueWork(500, ['tool result'], { maxTurns: work.maxTurns, stopRequested: false }), true);
  assert.equal(core.shouldContinueWork(1, [], { maxTurns: work.maxTurns, stopRequested: false }), false);
  assert.equal(core.shouldContinueWork(1, ['tool result'], { maxTurns: work.maxTurns, stopRequested: true }), false);
});

test('abort handle notifies listeners immediately and only once', () => {
  const abort = core.createAbortHandle();
  const reasons = [];

  abort.onAbort((reason) => reasons.push(reason));
  abort.abort('double escape');
  abort.abort('second abort');
  abort.onAbort((reason) => reasons.push('late:' + reason));

  assert.equal(abort.aborted, true);
  assert.equal(abort.reason, 'double escape');
  assert.deepEqual(reasons, ['double escape', 'late:double escape']);
  assert.equal(core.isAbortError(core.abortError('double escape')), true);
});
