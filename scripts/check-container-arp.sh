#!/bin/bash
# Prove the container image can actually ARP-scan as the runtime user.
#
# A `getcap` readout alone is NOT proof: the kernel refuses to execve() a file
# whose file capabilities exceed the process capability bounding set (EPERM)
# while getcap keeps printing those caps. This script therefore checks the
# advertisement AND performs the exec AND sends a real ARP request.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm --cap-add NET_RAW --user node \
  -v "$SCRIPT_DIR:/scripts:ro" \
  --entrypoint bash home-monitor:local /scripts/check-container-arp-inner.sh
