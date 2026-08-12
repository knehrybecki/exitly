# CRM LAN sidecar — wireguard-tools (kernel WG jak Gluetun).
# Build poza netns VPN (apk w runtime przez Proton pada).
FROM alpine:3.20
RUN apk add --no-cache wireguard-tools iproute2 iptables
ENTRYPOINT ["/bin/sh", "-c"]
