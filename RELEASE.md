# Releases & auto-update

vpn-hub Desktop ships installers for **macOS**, **Windows**, and **Linux**, and updates itself from **GitHub Releases** via `electron-updater`.

## One-time publish setup

1. Create the GitHub repo and push this project.
2. Replace `YOUR_GITHUB_USER` in:
   - `desktop/package.json` → `homepage`, `repository.url`, `build.publish[0].owner`
3. Commit and push.

Optional Apple notarization secrets (macOS Gatekeeper):

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID certificate
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`

Without them, macOS builds still upload; users may need right-click → Open the first time.

## Cut a release

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions (`.github/workflows/release.yml`) builds:

| OS | Artifacts |
|----|-----------|
| macOS | `.dmg` + `.zip` (zip required for auto-update) |
| Windows | NSIS `.exe` installer |
| Linux | `.AppImage` + `.deb` |

Assets are attached to the GitHub Release for that tag. The in-app updater reads `latest.yml` / `latest-mac.yml` / `latest-linux.yml` from that release.

## Local installers (no publish)

```bash
cd desktop
npm ci
npm run dist:mac     # or dist:win / dist:linux / dist
```

Outputs land in `desktop/dist/`.

## How in-app update works

1. Packaged app starts → checks GitHub Releases after a few seconds.
2. Banner shows **Update available** → user clicks **Download**.
3. When finished → **Restart & install**.
4. Manual: banner **Check** anytime.

Dev (`npm start`) cannot install updates — only packaged builds.

## Requirements on user machines

- Docker Desktop (Mac/Windows) or Docker Engine (Linux) with Compose v2
- Permission for `/dev/net/tun` (granted by Docker Desktop / rootless caveats on Linux)
