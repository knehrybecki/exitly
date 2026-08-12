# Releases & auto-update

Exitly Desktop ships installers for **macOS**, **Windows**, and **Linux**, and updates itself from **GitHub Releases** via `electron-updater`.

## One-time publish setup

1. Create the GitHub repo `exitly` and push this project.
2. Replace `YOUR_GITHUB_USER` in:
   - `desktop/package.json` → `homepage`, `repository.url`, `build.publish[0].owner`
3. Commit and push.

Optional Apple notarization secrets (macOS Gatekeeper):

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID certificate
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`

Without them, macOS builds still upload, but Gatekeeper may say the app is **damaged** after download. Clear quarantine once:

```bash
cd ~/Downloads
unzip -o Exitly-*-mac-arm64.zip
xattr -cr Exitly.app
open Exitly.app
```

Or: right-click `Exitly.app` → **Open** → confirm.

## Cut a release

```bash
git tag v1.0.3
git push origin v1.0.3
```

GitHub Actions builds TypeScript (`pnpm build`) then:

| OS | Artifact (one each) |
|----|---------------------|
| macOS (Apple Silicon / arm64) | `.zip` (also used by auto-update) |
| Windows | NSIS `.exe` |
| Linux | `.AppImage` |

macOS is **arm64 only** (M1–M5). Intel Macs are not supported.

Assets attach to the GitHub Release. The in-app updater reads `latest.yml` / `latest-mac.yml` / `latest-linux.yml`.

## Local installers (no publish)

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm build
pnpm dist:mac     # or dist:win / dist:linux / dist
```

Outputs: `desktop/dist/`.

## How in-app update works

1. Packaged app starts → checks GitHub Releases
2. Banner: **Update available** → **Download**
3. **Restart & install**
4. Manual: banner **Check**

Dev (`pnpm start`) cannot install updates — only packaged builds.

## Requirements on user machines

- Docker Desktop (Mac/Windows) or Docker Engine (Linux) with Compose v2
- `/dev/net/tun` available to Docker
