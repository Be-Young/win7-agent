# Win7 Agent Quickstart

This is the full EXE edition for Windows 7 x64.

## Install

1. Unzip `agent-win7-x64.zip` to a normal user-writable directory.
2. Copy `config\agent.example.json` to `config\agent.json`.
3. Edit `config\agent.json`:
   - `base_url`: internal OpenAI-compatible `/v1/chat/completions` endpoint
   - `model`: internal model name
   - `api_key`: leave empty if your gateway does not require it
4. Run:

```bat
agent.exe chat
```

## Common Commands

```bat
agent.exe chat
agent.exe skills
agent.exe model list
agent.exe model use fast
agent.exe memory show
agent.exe doc read report.docx
agent.exe doc ask report.docx "总结这个文档"
agent.exe doc rewrite report.docx --out report.rewrite.docx --instruction "改写得更正式"
agent.exe doc draft --type meeting --out meeting.md --topic "下周项目例会"
agent.exe doc create --format xlsx --out table.xlsx --prompt "生成三列表格：姓名、部门、备注"
agent.exe web read http://intranet/
agent.exe web ask http://intranet/ "这页讲了什么"
```

## Command Execution

Local command execution is enabled by default. Ordinary commands run directly; high-risk command prefixes ask for confirmation:

```json
"command": {
  "enabled": true,
  "confirm_prefixes": ["del", "reg", "powershell", "shutdown"],
    "blocked_prefixes": [],
    "always_confirm": false,
    "max_tool_rounds": 8
}
```

Commands in `blocked_prefixes` are refused.

When the model requests a command, the CLI sends stdout, errors, and cancellation results back to the model so it can continue the task. `max_tool_rounds` prevents an accidental infinite tool loop.

## Limitations

- Requires a Windows 7 x64 build of `agent.exe`.
- Static web pages are supported. JavaScript-rendered pages are not rendered.
- `docx` and `xlsx` support focuses on readable/generated content, not perfect Office layout preservation.

## VS Code Extension Quickstart

Use this when the Win7 office machine runs VS Code 1.70.x:

1. Install `win7-agent-vscode-0.4.4.vsix` with `Extensions -> ... -> Install from VSIX...`.
2. Open VS Code Settings JSON.
3. Configure:

```json
{
  "win7Agent.baseUrl": "http://你的内网地址/v1/chat/completions",
  "win7Agent.model": "你的模型名称",
  "win7Agent.apiKey": ""
}
```

4. Run `Win7 Agent: Open Chat` from the command palette.

The VSIX includes the same office skills and can reuse the bundled `agent.exe` for `docx/xlsx` document features.

Useful VS Code chat references:

```text
@file:src/app.js       引用当前项目中的文件
@skill:report          引用某个 skill
```

In chat, click `Project` to load the current workspace into context. Sending any task now starts continuous work by default, without a fixed turn limit. Press `Esc` twice to abort the current model request or command immediately. File edits made by the agent save rollback snapshots, and `Win7 Agent: Rollback Last File Change` restores the previous state.

Sessions are isolated. Use `New`, `Sessions`, `Rename`, and `Delete` in the chat toolbar, or the matching command palette commands, to manage historical conversations. Opening or switching a session restores its visible chat history.
