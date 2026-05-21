# Win7 Agent CLI Quickstart

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
agent.exe doc read report.docx
agent.exe doc ask report.docx "总结这个文档"
agent.exe doc rewrite report.docx --out report.rewrite.docx --instruction "改写得更正式"
agent.exe doc create --format xlsx --out table.xlsx --prompt "生成三列表格：姓名、部门、备注"
agent.exe web read http://intranet/
agent.exe web ask http://intranet/ "这页讲了什么"
```

## Command Execution

Local command execution is disabled by default. To enable it, set:

```json
"command": {
  "enabled": true,
  "allowed_prefixes": ["dir", "type", "findstr", "where", "ver", "echo"],
  "always_confirm": true
}
```

Commands outside the allowlist are refused.

## Limitations

- Requires a Windows 7 x64 build of `agent.exe`.
- Static web pages are supported. JavaScript-rendered pages are not rendered.
- `docx` and `xlsx` support focuses on readable/generated content, not perfect Office layout preservation.
