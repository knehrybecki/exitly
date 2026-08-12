# vpn-hub Desktop

Electron UI for the ProtonVPN hub — connect, switch country, disconnect, and copy “attach any app” snippets without using the terminal.

## Run

From the repo root (Docker must be available):

```bash
cd desktop
npm install
npm start
```

First launch:

1. Paste your Proton WireGuard **PrivateKey** (Account → VPN → WireGuard)
2. Pick a country → **Connect**
3. Use the **Connect any app** panel to wire your projects

## What the app controls

| Action | Effect |
|--------|--------|
| Connect / Switch | `vpn use <country>` → container `proton-vpn` |
| Disconnect | `vpn down` |
| Parallel RO/HU/BG | `vpn up` / `vpn down` on `vpn-ro`… |
| Check IP | `ipinfo` via the tunnel |

Keys stay in the hub `.env` on disk. Nothing is sent to a third-party backend.
