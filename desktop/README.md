# Exitly Desktop

Cross-platform Electron app for Exitly.

| Platform | Installer |
|----------|-----------|
| macOS | `.dmg` |
| Windows | NSIS `.exe` |
| Linux | `.AppImage` / `.deb` |

In-app updates use GitHub Releases (`electron-updater`).

## Develop

```bash
cd desktop
pnpm install
pnpm start
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

## Features

- Connect / switch country / disconnect
- Parallel RO/HU/BG exits
- Crawlers panel — register Docker images, Start / Stop through the VPN exit
- Publish app endpoints on the hub (Ollama preset, custom ports)
- Copy Docker `network_mode` + HTTP proxy snippets
- Auto-update banner (packaged builds)
