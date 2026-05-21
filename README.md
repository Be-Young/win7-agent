# Win7 Agent CLI

Two trial editions are included:

- Full EXE edition: Go 1.20 source for a Windows 7 x64 `agent.exe`.
- Script Lite edition: `agent.cmd` + `agent.js`, intended for email trials when EXE attachments are blocked.

中文用户请先阅读：[中文操作手册](docs/user-manual-zh.md)。

## Full EXE Edition

Build on a machine with Go 1.20:

```bat
scripts\build-win7-exe.cmd
```

The EXE edition supports:

- OpenAI-compatible `POST /v1/chat/completions`
- Optional streaming
- local `SKILL.md` loading
- `txt/md/csv/json/log/docx/xlsx` reading
- `txt/md/csv/docx/xlsx` creation as new files
- static intranet web page reading
- allowlisted command execution with confirmation and audit logging

## Script Lite Edition

Run on Windows 7 with built-in `cscript.exe`:

```bat
agent.cmd chat
```

The script edition supports:

- non-streaming OpenAI-compatible chat
- local `SKILL.md` loading
- `txt/md/csv/json/log` reading
- simple static intranet web page reading

It does not execute commands and does not process Office files.

## Configuration

Copy `config\agent.example.json` to `config\agent.json`, then edit:

- `base_url`
- `model`
- `api_key` if required
- optional `headers` or `auth_profiles` for intranet pages

Do not rename, encrypt, or disguise EXE files to bypass email controls. Use IT review, signing, or internal software distribution.
