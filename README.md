# Exitquay

<p align="center">
  <img src="brand/logo-banner.png" alt="Exitquay" width="720" />
</p>

**ProtonVPN country exits for every Docker project.** One WireGuard key, easy switching, optional parallel exits — desktop app or CLI.

Built on [Gluetun](https://github.com/qdm12/gluetun). Apps attach with `network_mode: "container:proton-vpn"` — no Proton Desktop in each project.

## Why Exitquay?

- Side projects need VPN exits in **different countries**
- Installing Proton GUI/CLI per VM does not scale
- One shared quay (hub): switch country once, reuse from any compose stack

## Requirements

- Docker + Docker Compose v2
- ProtonVPN account (WireGuard)
- `/dev/net/tun` (Linux, OrbStack, Docker Desktop)

## Quick start (Desktop — recommended)

### Install from a release

Download for your OS from GitHub **Releases**:

- macOS → `.dmg`
- Windows → `.exe` (NSIS)
- Linux → `.AppImage` or `.deb`

The app auto-updates from the in-app banner.

### Run from source

```bash
git clone https://github.com/YOUR_GITHUB_USER/exitquay.git
cd exitquay/desktop
npm install
npm start
```

1. Paste Proton WireGuard **PrivateKey**  
   ([Proton WireGuard configs](https://account.proton.me/u/0/vpn/WireGuard))
2. Choose a country → **Connect**
3. Use **Connect any app** to copy Docker / proxy snippets

Build & publish: [`RELEASE.md`](RELEASE.md) · [`desktop/README.md`](desktop/README.md)

## Quick start (CLI)

```bash
git clone https://github.com/YOUR_GITHUB_USER/exitquay.git
cd exitquay
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

## Connect any app

### Option A — Docker `network_mode` (best)

```yaml
services:
  app:
    build: .
    network_mode: "container:proton-vpn"
```

Country switches in Exitquay do **not** require changing the project. See [`snippets/docker-compose.app.yml`](snippets/docker-compose.app.yml).

### Option B — HTTP proxy

```bash
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
export NO_PROXY=localhost,127.0.0.1
```

From another container: `http://host.docker.internal:8888`.

### Option C — Parallel countries

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
- Exitquay is not a full OS sandbox — mount only what you need

## Credits

- [qdm12/gluetun](https://github.com/qdm12/gluetun)
- [Proton VPN](https://protonvpn.com/)

## License

MIT — see [LICENSE](LICENSE).
