# Build and Package

The EXE edition must be built on a machine with Go 1.20 available. The VS Code extension package can then be built on a packaging machine with Node.js and `zip`; it has no npm dependency install step.

## Build Windows 7 x64 EXE

```bat
scripts\build-win7-exe.cmd
```

The script runs tests, builds `dist\agent-win7-x64\agent.exe`, and copies `config`, `skills`, and `docs`.

## Package VS Code Extension VSIX

After `dist\agent-win7-x64\agent.exe` exists, run:

```sh
node scripts/package-vscode-extension.js
```

This creates:

```text
dist/win7-agent-vscode-0.4.1.vsix
```

The VSIX contains:

- `extension/package.json`
- `extension/extension.js`
- `extension/lib/core.js`
- bundled `skills/`
- bundled `config/`
- Chinese manuals
- `extension/agent.exe` copied from `dist/agent-win7-x64/agent.exe` when available
- project context, file edits, rollback snapshots, references, and continuous work mode

The extension targets VS Code `^1.70.0`, because VS Code 1.70.3 is the last Windows 7 release.

## Notes for IT Review

- No external Go modules are required.
- The EXE uses only the Go standard library.
- The VS Code extension has no npm runtime dependencies.
- The VSIX is a ZIP-format extension package for private/offline distribution.
- Do not rename or encrypt EXE packages to bypass email controls. Use IT review, signing, or an internal software share.
