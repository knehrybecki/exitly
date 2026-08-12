# Contributing to Exitly

Issues and PRs welcome.

## Ideas that fit well

- Extra parallel country services in `docker-compose.yml`
- More entries in `countries.conf`
- Small CLI UX improvements (`bin/vpn`)
- Docs / snippets for Kubernetes, Podman, rootless
- Brand / icon refinements in `brand/`

## Please avoid

- Committing `.env`, keys, or live WireGuard configs
- Bundling proprietary Proton Desktop apps
- Provider-specific credentials in the repo

## Dev check

```bash
./bin/vpn help
./bin/vpn countries
# with a real .env:
./bin/vpn use ro && ./bin/vpn ip

cd desktop && pnpm start
```
