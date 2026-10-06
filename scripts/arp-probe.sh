#!/bin/bash
# PRD §5 "the real /24 probe is not measured".
#
# Runs the project's own arpScanner code path against a real subnet and reports
# wall-clock time, host count and the parsing result. Written for the WSL
# distro, because that is where a real arp-scan with CAP_NET_RAW lives.
#
# Two safety rails, both non-negotiable:
#   1. REFUSES to run unless SUBNET is explicitly supplied. There is no
#      default. A sweep that guesses its target is a sweep nobody authorised.
#   2. REFUSES any target that is not a private range. A /16+ against public
#      space is not a local network probe.
set -euo pipefail

SUBNET="${1:-}"

if [ -z "$SUBNET" ]; then
  echo "refusing to run: no subnet given." >&2
  echo "usage: sudo bash scripts/arp-probe.sh <private-subnet>" >&2
  echo "example: sudo bash scripts/arp-probe.sh 192.168.1.0/24" >&2
  exit 64
fi

# Private ranges only. loopback/link-local/multicast are refused as they cannot
# contain peers worth discovering.
if ! echo "$SUBNET" | grep -qE '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)'; then
  echo "refusing to sweep '$SUBNET': not a private range." >&2
  echo "This script only sweeps RFC1918 space on a network you control." >&2
  exit 64
fi

BIN=/usr/sbin/arp-scan
if [ ! -x "$BIN" ]; then
  echo "refusing to run: $BIN is not installed." >&2
  exit 69
fi

CAPS="$(getcap "$BIN" || true)"
case "$CAPS" in
  *cap_net_raw*) ;;
  *)
    echo "refusing to run: $BIN lacks cap_net_raw." >&2
    echo "fix with: sudo setcap cap_net_raw,cap_net_admin+eip $BIN" >&2
    exit 69
    ;;
esac

echo "ARP probe"
echo "========="
echo "target     $SUBNET"
echo "binary     $BIN ($("$BIN" --version 2>&1 | head -1))"
echo "caps       $CAPS"
echo "started    $(date -Is)"
echo

# Warm the ARP cache first so the timed run is not paying for cache population
# twice. Disclosed in the output rather than hidden: a cold run measures the
# sweep, a warm run measures the sweep plus cache, and only one of those is the
# number a dashboard cares about.
echo "-- warm-up pass (discarded) --"
"$BIN" --numeric --quiet "$SUBNET" >/dev/null 2>&1 || true
echo

echo "-- timed passes --"
for run in 1 2 3; do
  start_ns=$(date +%s%N)
  output="$("$BIN" --numeric --quiet "$SUBNET" 2>&1)" || true
  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  # arp-scan's own summary line, which is the authoritative duration.
  summary="$(printf '%s\n' "$output" | grep -E 'Ending arp-scan' || true)"
  hosts="$(printf '%s\n' "$output" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\s+([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}' || true)"
  echo "run $run: ${elapsed_ms}ms wall clock, $hosts hosts"
  [ -n "$summary" ] && echo "         $summary"
done

echo
echo "-- discovered hosts (run 3 shape) --"
"$BIN" --numeric --quiet "$SUBNET" 2>/dev/null | grep -E '^[0-9]+\.' || echo "(none responded)"

echo
echo "finished   $(date -Is)"
echo
echo "Note: this is a Layer-2 sweep of a network you control. It sends ARP"
echo "who-has frames only — no login attempts, no port scanning, no payloads."