# Win7 Agent for VS Code

Win7 Agent for VS Code is an offline-friendly extension for Windows 7 machines running VS Code 1.70.x. It connects to an intranet OpenAI-compatible API and reuses the same `config`, `skills`, memory, command policy, web reading, and document workflow ideas as the Win7 Agent CLI.

## Windows 7 Target

Microsoft lists VS Code 1.70.3 as the last release for Windows 7. This extension therefore uses plain CommonJS JavaScript, no npm runtime dependencies, and `"engines.vscode": "^1.70.0"`.

## Features

- Webview chat with model switching and persistent memory.
- OpenAI-compatible `/v1/chat/completions`, including optional SSE streaming.
- `SKILL.md` loading from bundled skills and workspace skill folders.
- Text file context loading, plus `docx`/`xlsx` reading through bundled or configured `agent.exe`.
- Intranet static page reading with headers, cookies, and basic auth profiles.
- Optional intranet HTTPS CA file or certificate verification skip setting.
- Local command execution enabled by default, with high-risk prefixes requiring confirmation.
- Office document drafting for meeting notes, emails, notices, reports, summaries, and proposals.
- Full `docx`/`xlsx` generation through the bundled Win7 `agent.exe`.

## Offline Install

1. Install VS Code 1.70.3 x64 on Windows 7.
2. Copy `win7-agent-vscode-0.3.0.vsix` into the intranet.
3. In VS Code, open Extensions, choose `...`, then `Install from VSIX...`.
4. Open Settings JSON and configure at least:

```json
{
  "win7Agent.baseUrl": "http://model-gateway.local/v1/chat/completions",
  "win7Agent.model": "your-model-name",
  "win7Agent.apiKey": ""
}
```

Use `Win7 Agent: Open Chat` from the command palette to start.

## Model Profiles

```json
{
  "win7Agent.activeModel": "fast",
  "win7Agent.models": {
    "fast": {
      "baseUrl": "http://model-gateway.local/v1/chat/completions",
      "model": "fast-model",
      "stream": true
    },
    "accurate": {
      "baseUrl": "http://model-gateway.local/v1/chat/completions",
      "model": "accurate-model",
      "stream": false
    }
  }
}
```

## Commands

- `Win7 Agent: Open Chat`
- `Win7 Agent: Ask Selection`
- `Win7 Agent: Read URL into Context`
- `Win7 Agent: Read File into Context`
- `Win7 Agent: Draft Office Document`
- `Win7 Agent: Switch Model`
- `Win7 Agent: Run Local Command`
- `Win7 Agent: Show Memory`
- `Win7 Agent: Clear Memory`
- `Win7 Agent: Open Chinese Manual`
