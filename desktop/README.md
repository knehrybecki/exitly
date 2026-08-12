# vpn-hub Desktop

Cross-platform Electron app for the ProtonVPN hub.

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
# or all for current OS tooling:
npm run dist
```

See [`../RELEASE.md`](../RELEASE.md) for tagging, CI, and auto-update.

## Features

- Connect / switch country / disconnect (no terminal)
- Parallel RO/HU/BG exits
- Copy Docker `network_mode` + HTTP proxy snippets
- Auto-update banner (packaged builds)
