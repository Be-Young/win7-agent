# Build and Package

The full EXE edition must be built on a machine with Go 1.20 available.

## Build Windows 7 x64 EXE

```bat
scripts\build-win7-exe.cmd
```

The script runs tests, builds `dist\agent-win7-x64\agent.exe`, and copies `config`, `skills`, and `docs`.

## Notes for IT Review

- No external Go modules are required.
- The EXE uses only the Go standard library.
- Do not rename or encrypt EXE packages to bypass email controls. Use IT review, signing, or an internal software share.
