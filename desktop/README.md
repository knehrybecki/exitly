# Exitly Desktop

Cross-platform Electron app (TypeScript) for Exitly projects.

| Platform | Installer |
|----------|-----------|
| macOS | `.dmg` / `.zip` |
| Windows | NSIS `.exe` |
| Linux | `.AppImage` / `.deb` |

In-app updates use GitHub Releases (`electron-updater`).

## Features

- Projects: Docker compose **or** CLI (OpenCode / Codex / …)
- New / Open / Import `.zip` / **Duplicate** (rename + folder)
- Per-project country, models, workers, start options, env, logs
- CRM LAN (host WireGuard) toggle per project
- Global Serper + Ollama settings
- Auto-update banner (packaged builds)

## Layout

```
src/
  main/          Electron main + IPC
  preload.ts
  updater.ts
  hub/           VPN, Docker, projects, settings…
    util/        Pure helpers (tested)
  renderer/      UI modules → bundled to renderer/renderer.js
  shared/        IPC channels + types
lib/             tsc output (main process)
templates/       Project scaffolds (packaged with the app)
tests/           Vitest
```

## Develop

```bash
cd desktop
pnpm install
pnpm start
```

Jeśli `start` krzyczy o brak `tsc` / `esbuild` — zależności są uszkodzone:

```bash
rm -rf node_modules
pnpm install
pnpm start
```

```bash
pnpm test
pnpm build
```

Requires Docker on the host. First run: paste WireGuard PrivateKey.

## Build installers locally

```bash
pnpm dist:mac
pnpm dist:win
pnpm dist:linux
pnpm dist
```

See [`../RELEASE.md`](../RELEASE.md).
