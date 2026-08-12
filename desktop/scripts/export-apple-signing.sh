#!/usr/bin/env bash
# Export Developer ID Application cert for Exitly GitHub Actions signing.
# Prerequisites: Apple Developer Program + "Developer ID Application" in Keychain.
set -euo pipefail

IDENTITY="${1:-}"
OUT_DIR="${TMPDIR:-/tmp}/exitly-signing"
PASS="${CSC_EXPORT_PASSWORD:-exitly-ci-export}"

mkdir -p "$OUT_DIR"
P12="$OUT_DIR/developer-id.p12"

echo "==> Available code-signing identities:"
security find-identity -v -p codesigning || true
echo

if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/{print $2; exit}')"
fi

if [ -z "$IDENTITY" ]; then
  cat <<'EOF'
No "Developer ID Application" identity found.

1. Enroll: https://developer.apple.com/programs/
2. Certificates → "+" → Developer ID Application
3. Create CSR in Keychain Access → Certificate Assistant → Request from CA
4. Download .cer, double-click to install into login keychain
5. Re-run: pnpm exec bash scripts/export-apple-signing.sh

EOF
  exit 1
fi

echo "==> Exporting: $IDENTITY"
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities -f pkcs12 -o "$P12" -P "$PASS" "$IDENTITY" 2>/dev/null \
  || security export -t identities -f pkcs12 -o "$P12" -P "$PASS" "$IDENTITY"

B64="$(base64 -i "$P12" | tr -d '\n')"

echo
echo "==> Set GitHub secrets (repo knehrybecki/exitly):"
echo
echo "gh secret set CSC_LINK --body \"$B64\""
echo "gh secret set CSC_KEY_PASSWORD --body \"$PASS\""
echo "gh secret set APPLE_ID --body \"YOUR_APPLE_ID@email.com\""
echo "gh secret set APPLE_APP_SPECIFIC_PASSWORD --body \"xxxx-xxxx-xxxx-xxxx\""
echo "gh secret set APPLE_TEAM_ID --body \"TEAMID10CH\""
echo
echo "App-specific password: https://appleid.apple.com → Sign-In and Security → App-Specific Passwords"
echo "Team ID: https://developer.apple.com/account → Membership"
echo
echo "P12 saved at: $P12 (password: $PASS) — delete after uploading secrets."
