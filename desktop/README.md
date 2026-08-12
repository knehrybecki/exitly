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
npm install
npm start
```

Requires Docker on the host. First run: paste WireGuard PrivateKey.

## Build installers locally

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run dist
```

See [`../RELEASE.md`](../RELEASE.md).

## Features

- Connect / switch country / disconnect
- Parallel RO/HU/BG exits
- Copy Docker `network_mode` + HTTP proxy snippets
- Auto-update banner (packaged builds)
