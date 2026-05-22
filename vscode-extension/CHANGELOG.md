# Changelog

## 0.4.1

- Clarified command execution prompting so models request local commands with `agent-action` instead of refusing with environment-limit messages.

## 0.4.0

- Added workspace/project context loading.
- Added file references and skill references in chat.
- Added isolated session management with new, switch, rename, and delete.
- Added continuous work mode with double-Escape stop.
- Added model-proposed project file edits through `agent-files` blocks.
- Added rollback snapshots for extension-applied file changes.

## 0.3.0

- Added Windows 7 compatible VS Code extension.
- Added Webview chat, model switching, skills, memory, URL/file context, command execution, and document drafting.
- Bundled-agent workflow supports full CLI document features when packaged with `agent.exe`.
