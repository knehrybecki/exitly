# vpn-hub

Reusable **ProtonVPN exit hub** for Docker projects. One WireGuard key, easy country switching, optional parallel exits per country.

Built on [Gluetun](https://github.com/qdm12/gluetun). Your apps just attach with `network_mode: "container:proton-vpn"` — no Proton Desktop, no per-project VPN install.

## Why

- Many side projects need a VPN exit in **different countries**
- Installing Proton GUI / CLI in every VM or container does not scale
- This repo is a small shared hub: switch country in one place, reuse from any compose stack

## Requirements

- Docker + Docker Compose v2
- ProtonVPN account (WireGuard)
- `/dev/net/tun` (Linux, OrbStack, Docker Desktop with VPN-capable VM)

## Quick start

```bash
git clone https://github.com/YOUR_USER/vpn-hub.git
cd vpn-hub
./bin/vpn setup
```

1. Open [Proton WireGuard configs](https://account.proton.me/u/0/vpn/WireGuard)
2. Generate a config (any server) and copy **PrivateKey**
3. Put it in `.env` as `WIREGUARD_PRIVATE_KEY=...`
4. Connect:

```bash
./bin/vpn use ro
./bin/vpn ip
```

Optional PATH install:

```bash
ln -sf "$(pwd)/bin/vpn" ~/.local/bin/vpn
```

## Use from any project

```yaml
services:
  app:
    build: .
    network_mode: "container:proton-vpn"
```

See [`snippets/docker-compose.app.yml`](snippets/docker-compose.app.yml).

Switch exit without touching the app:

```bash
vpn use hu    # Hungary
vpn use bg    # Bulgaria
vpn use de    # Germany
vpn ip
```

## Parallel countries

When several projects need different exits at once:

```bash
vpn up ro hu
```

Then pin each app:

```yaml
# project A
network_mode: "container:vpn-ro"
# project B
network_mode: "container:vpn-hu"
```

Shipped parallel profiles: `ro`, `hu`, `bg`. Add more services in `docker-compose.yml` the same way.

## CLI

| Command | Description |
|--------|-------------|
| `vpn setup` | Create `.env` from example |
| `vpn use <code>` | Switch active exit (`proton-vpn`) |
| `vpn up` / `vpn down` | Start/stop active exit |
| `vpn up ro hu` | Start parallel exits |
| `vpn status` | Container status |
| `vpn ip` | Public IP / geo check |
| `vpn countries` | List codes from `countries.conf` |
| `vpn which` | Print `network_mode` snippet |

## Add a country

1. Add a line to [`countries.conf`](countries.conf): `xx=Country Name`
2. `vpn use xx` (single active exit)

For a dedicated parallel container, copy the `vpn-ro` service block in `docker-compose.yml` and change the name + `SERVER_COUNTRIES`.

## HTTP proxy (optional)

Gluetun exposes an HTTP proxy on host port `8888` (override with `HTTP_PROXY_PORT` in the environment / compose). Useful when an app must keep its own Docker network:

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
export HTTP_PROXY=http://127.0.0.1:8888
```

## Security notes

- Never commit `.env` or WireGuard private keys
- Prefer `network_mode: container:…` so the app cannot leak outside the tunnel
- This hub does not replace OS sandboxing; mount only the volumes you need into app containers

## Credits

- VPN client container: [qdm12/gluetun](https://github.com/qdm12/gluetun)
- Provider: [Proton VPN](https://protonvpn.com/)

## License

MIT — see [LICENSE](LICENSE).
