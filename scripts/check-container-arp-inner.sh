#!/bin/bash
# Inner half of check-container-arp.sh, mounted into the image at /scripts.
# Kept separate so the outer script never has to nest quoting.
set -u

echo "--- runtime user (matches image USER directive) ---"
echo "uid=$(id -u) name=$(id -un)"

echo "--- capability advertisement ---"
echo "getcap=$(getcap /usr/sbin/arp-scan 2>&1)"

echo "--- exec probe: arp-scan --help ---"
arp-scan --help >/dev/null 2>&1
echo "exec exit=$? (0 = kernel allowed the exec)"

echo "--- live ARP sweep of the container default gateway ---"
gw=$(node /scripts/container-gateway.js)
echo "gateway=$gw (RFC1918 docker bridge)"
arp-scan --numeric --quiet "$gw" 2>&1 | head -3
echo "sweep exit=${PIPESTATUS[0]}"
