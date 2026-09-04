# Changelog

## 0.4.4

- Fixed live SSE text not appearing in the chat body until the response completed.
- Restored visible conversation history when opening, switching, clearing, or deleting sessions.
- Persisted real command and file tool results during continuous work instead of synthetic step placeholders.
- Added CLI multi-step command tool calls with result feedback and a configurable eight-round default limit.
- Hardened command policies so high-risk commands in compound shell expressions cannot bypass checks.
- Escaped control characters in command audit records to prevent forged log lines.
- Prevented workspace scans and model file changes from following symbolic links outside the project.
- Fixed nested workspace scanning when custom text extensions exclude Markdown.
- Preserved sparse Excel column positions and all rich inline-text runs when the bundled CLI reads `.xlsx` files.
- Preserved explicit Authorization headers and allowed model profiles to clear an inherited API key.

## 0.4.3

- Enabled continuous work by default for every chat send and removed the chat `Work` toggle.
- Removed the default continuous work turn cap; the loop continues while tool results require another step.
- Split assistant UI into the final answer plus collapsed `Think`, `Agent Action`, and `Agent Files` sections.
- Double-Escape now aborts the current model request or command instead of waiting for the current step to finish.

## 0.4.2

- Feed `agent-action` command stdout, stderr, exit code, and errors back into the chat workflow.
- Continue the normal chat automatically after command execution so tool results are visible to the model.
- Preserve command output even when a command exits with a non-zero status.

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
