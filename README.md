# Win7 Agent CLI

This repository builds one Windows 7 x64 EXE edition:

- Full EXE edition: Go 1.20 source for a Windows 7 x64 `agent.exe`.

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
