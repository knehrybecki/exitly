# Exitly

<p align="center">
  <img src="brand/logo-banner.png" alt="Exitly" width="720" />
</p>

**ProtonVPN country exits for every Docker / CLI project.** One WireGuard key, per-project countries, desktop app or CLI.

Built on [Gluetun](https://github.com/qdm12/gluetun).

## Why Exitly?

- Side projects need VPN exits in **different countries**
- Installing Proton GUI/CLI per VM does not scale
- One hub + projects: each stack gets its own exit, models, env, and logs

## Requirements

- Docker + Docker Compose v2
- ProtonVPN account (WireGuard)
- `/dev/net/tun` (Linux, OrbStack, Docker Desktop)

## Install (Desktop — recommended)

Download from [GitHub Releases](https://github.com/knehrybecki/exitly/releases):

| Platform | File |
|----------|------|
| macOS Apple Silicon | `Exitly-*-mac-arm64.dmg` |
| macOS Intel | `Exitly-*-mac-x64.dmg` |
| Windows | `Exitly-*-win-x64.exe` |
| Linux | `Exitly-*-linux-x86_64.AppImage` or `.deb` |

The packaged app auto-updates from the in-app banner. Unsigned macOS builds may show as “damaged” after download — run `xattr -cr Exitly.app` (or right-click → Open).

### Run from source

```bash
git clone https://github.com/knehrybecki/exitly.git
cd exitly/desktop
pnpm install
pnpm build
pnpm start
```

Optional: `pnpm test`

1. Paste Proton WireGuard **PrivateKey**  
   ([Proton WireGuard configs](https://account.proton.me/u/0/vpn/WireGuard))
2. Create or open a **project** (Docker compose or CLI)
3. Pick country / models / CRM LAN on the project card → **Włącz** / **Uruchom**

Projects support **Import / Export (.zip)** and **Duplikuj** (new name + folder).

Build & publish: [`RELEASE.md`](RELEASE.md) · [`desktop/README.md`](desktop/README.md)

## Quick start (CLI)

```bash
git clone https://github.com/knehrybecki/exitly.git
cd exitly
./bin/vpn setup
```

1. Open [Proton WireGuard configs](https://account.proton.me/u/0/vpn/WireGuard)
2. Copy **PrivateKey** into `.env` as `WIREGUARD_PRIVATE_KEY=...`
3. Connect:

```bash
./bin/vpn use ro
./bin/vpn ip
```

```bash
ln -sf "$(pwd)/bin/vpn" ~/.local/bin/vpn
```

## Attach apps to an exit

### Option A — Docker `network_mode` (best)

Per-project tunnels use dedicated container names (`exitly-vpn-…`). Shared hub exit:

```yaml
services:
  app:
    build: .
    network_mode: "container:proton-vpn"
```

See [`snippets/docker-compose.app.yml`](snippets/docker-compose.app.yml).

### Option B — HTTP proxy

```bash
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
export NO_PROXY=localhost,127.0.0.1
```

From another container: `http://host.docker.internal:8888`.

### Option C — Parallel countries (CLI)

```bash
./bin/vpn up ro hu
```

```yaml
# project A
network_mode: "container:vpn-ro"
# project B
network_mode: "container:vpn-hu"
```

## CLI

| Command | Description |
|--------|-------------|
| `vpn setup` | Create `.env` |
| `vpn use <code>` | Switch active exit (`proton-vpn`) |
| `vpn up` / `vpn down` | Start/stop active exit |
| `vpn up ro hu` | Parallel exits |
| `vpn status` / `vpn ip` | Status / public IP |
| `vpn countries` | List codes |

## Brand

| Asset | Path |
|-------|------|
| App icon | [`brand/icon.png`](brand/icon.png) · [`desktop/build/icon.png`](desktop/build/icon.png) |
| Banner | [`brand/logo-banner.png`](brand/logo-banner.png) |

## Security

- Never commit `.env` or WireGuard keys
- Prefer `network_mode: container:…` to avoid leaks
- Exitly is not a full OS sandbox — mount only what you need

## Credits

- [qdm12/gluetun](https://github.com/qdm12/gluetun)
- [Proton VPN](https://protonvpn.com/)

## License

MIT — see [LICENSE](LICENSE).
