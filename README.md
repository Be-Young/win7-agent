# Win7 Agent

This repository builds two Windows 7 x64 deliverables:

- Full EXE edition: Go 1.20 source for a Windows 7 x64 `agent.exe`.
- VS Code extension edition: offline `.vsix` for Windows 7 VS Code 1.70.x, bundled with `agent.exe` for full document support.

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
- static intranet web page reading with cleaner article/table extraction
- model profile switching
- persistent local conversation/context memory
- command execution enabled by default, with high-risk prefixes requiring confirmation

## Configuration

Copy `config\agent.example.json` to `config\agent.json`, then edit:

- `base_url`
- `model`
- `api_key` if required
- optional `headers` or `auth_profiles` for intranet pages
- optional `models` profiles for `/model <name>` switching

Do not rename, encrypt, or disguise EXE files to bypass email controls. Use IT review, signing, or internal software distribution.

## VS Code Extension Edition

Windows 7 can only run the legacy VS Code 1.70.x line. The extension is therefore plain CommonJS JavaScript with no npm runtime dependencies and `engines.vscode` set to `^1.70.0`.

Package the VSIX after the EXE has been built:

```sh
node scripts/package-vscode-extension.js
```

The output is:

```text
dist/win7-agent-vscode-0.4.1.vsix
```

The VSIX includes:

- VS Code Webview chat
- continuous project work mode
- model switching
- bundled and workspace `SKILL.md` loading
- persistent memory
- workspace/project context, referenced files, text file and intranet URL context
- project file create/write/replace/delete with rollback snapshots
- command execution with high-risk confirmation
- office document drafting
- bundled `agent.exe` reuse for `docx/xlsx` read/write features
