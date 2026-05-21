# Win7 Agent Script Lite Quickstart

This package is designed for email testing when `.exe` attachments are blocked.

## Install

1. Unzip `agent-script-lite.zip`.
2. Copy `config\agent.example.json` to `config\agent.json`.
3. Edit `base_url`, `model`, and optional `api_key`.
4. Run:

```bat
agent.cmd chat
```

## Commands

```bat
agent.cmd chat
agent.cmd ask "你好，介绍一下你能做什么"
agent.cmd file notes.md "总结这个文件"
agent.cmd url http://intranet/ "总结这个网页"
agent.cmd skills
```

## What This Lite Version Does Not Do

- No `.exe` file.
- No local command execution.
- No `docx` or `xlsx` parsing/generation.
- No streaming output.
- No browser rendering for JavaScript-heavy pages.

Use the EXE edition for full document and command features.
