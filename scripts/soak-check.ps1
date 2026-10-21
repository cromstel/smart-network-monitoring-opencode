<#
.SYNOPSIS
  One-shot soak checkpoint, invoked by scheduled tasks (SNM-Soak-Check-*).

.DESCRIPTION
  Appends a timestamped status block to doc\soak-checkpoints.log and, when the
  soak has finished, the full content of doc\SOAK.md (the harness's verdict
  artifact, written by scripts/soak.ts only at completion).

  Runs from Task Scheduler (outside opencode's process tree) so it survives
  opencode server restarts - the failure mode that cancelled both of the
  original opencode background-shell checkpoints on 2026-10-14.
#>
# The repository root is derived from this script's location rather than
# hardcoded, so the checkpoint runs from any checkout. `$PSScriptRoot` is the
# directory holding this file (`scripts/`), so its parent is the repository.
$root   = (Split-Path -Parent $PSScriptRoot)
$log    = Join-Path $root 'doc\soak-checkpoints.log'
$lines  = @("==== checkpoint $(Get-Date -Format o) ====")

# attempt 3 runs the soak as data\node-soak.exe (renamed node.exe) so name-based
# `Get-Process "node"` sweeps from other agents cannot match it - detect BOTH names.
$soak = Get-CimInstance Win32_Process -Filter "Name='node-soak.exe' or Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*soak.ts*' }
$wrap = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*soak-launch.ps1*' }
$lines += if ($soak) { "soak node   : ALIVE pid=$($soak.ProcessId)" } else { "soak node   : DEAD" }
$lines += if ($wrap) { "wrapper     : ALIVE pid=$($wrap.ProcessId)" } else { "wrapper     : DEAD" }

$out = Join-Path $root 'doc\soak-2026-10-14.out.log'
if (Test-Path $out) {
  $i = Get-Item $out
  $lines += "out.log     : $($i.Length) bytes, last write $($i.LastWriteTime.ToString('o'))"
} else {
  $lines += "out.log     : MISSING"
}

$lines += ("free disk   : {0:N2} GB" -f ((Get-PSDrive C).Free / 1GB))
$npmCache = Join-Path $env:LOCALAPPDATA 'npm-cache'
if (Test-Path $npmCache) {
  $n = (Get-ChildItem $npmCache -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  $lines += ("npm-cache   : {0:N1} MB (watch for unexplained refill)" -f ($n / 1MB))
}
$ka = Get-Process -Id 47700 -ErrorAction SilentlyContinue
$lines += if ($ka) { "keep-awake  : pid 47700 ALIVE" } else { "keep-awake  : pid 47700 gone (wrapper's own hold covers the soak)" }

$soakMd = Join-Path $root 'doc\SOAK.md'
if (Test-Path $soakMd) {
  $lines += "SOAK.md     : EXISTS (soak completed)"
  $lines += (Get-Content $soakMd -Raw)
} else {
  $lines += "SOAK.md     : not yet (written only at completion)"
}

Add-Content -Path $log -Value ($lines -join "`r`n") -Encoding UTF8
