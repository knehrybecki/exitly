# Releases & auto-update

Exitquay Desktop ships installers for **macOS**, **Windows**, and **Linux**, and updates itself from **GitHub Releases** via `electron-updater`.

## One-time publish setup

1. Create the GitHub repo `exitquay` and push this project.
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

Assets attach to the GitHub Release. The in-app updater reads `latest.yml` / `latest-mac.yml` / `latest-linux.yml`.

## Local installers (no publish)

```bash
cd desktop
npm ci
npm run dist:mac     # or dist:win / dist:linux / dist
```

Outputs: `desktop/dist/`.

## How in-app update works

1. Packaged app starts → checks GitHub Releases
2. Banner: **Update available** → **Download**
3. **Restart & install**
4. Manual: banner **Check**

Dev (`npm start`) cannot install updates — only packaged builds.

## Requirements on user machines

- Docker Desktop (Mac/Windows) or Docker Engine (Linux) with Compose v2
- `/dev/net/tun` available to Docker
