# Releases & auto-update

Exitly Desktop ships installers for **macOS**, **Windows**, and **Linux**, and updates itself from **GitHub Releases** via `electron-updater`.

## One-time publish setup

1. Create the GitHub repo `exitly` and push this project.
2. Replace `YOUR_GITHUB_USER` in:
   - `desktop/package.json` → `homepage`, `repository.url`, `build.publish[0].owner`
3. Commit and push.

## macOS: open without Gatekeeper (“damaged”)

Apple blocks **unsigned** apps downloaded from the internet. The only real fix is
**Developer ID signing + notarization** (Apple Developer Program, ~$99/year).

### One-time Apple setup

1. Enroll at https://developer.apple.com/programs/
2. Create certificate **Developer ID Application** (Certificates, Identifiers & Profiles)
3. Install it in Keychain, then from `desktop/`:

```bash
bash scripts/export-apple-signing.sh
```

4. Create an [app-specific password](https://appleid.apple.com) and note your **Team ID**
5. Set GitHub Actions secrets (script prints `gh secret set …` commands):

| Secret | Value |
|--------|--------|
| `CSC_LINK` | Base64 of the `.p12` |
| `CSC_KEY_PASSWORD` | Password used when exporting `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-char Team ID |

6. Cut a new release tag — CI signs + notarizes the macOS zip. Gatekeeper opens it with a normal double-click.

Without secrets, macOS may say the app is **damaged**. Temporary unblock only:

```bash
xattr -cr ~/Downloads/Exitly.app && open ~/Downloads/Exitly.app
```

There is no code-only bypass for downloads from GitHub.

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
