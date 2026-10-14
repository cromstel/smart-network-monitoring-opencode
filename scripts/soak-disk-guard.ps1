<#
.SNOPSIS
  Disk guard for the 24h soak window, invoked by the SNM-Disk-Guard task.

.DESCRIPTION
  Appends the current free space to doc\soak-checkpoints.log, then - ONLY when
  free space drops below the threshold - clears npm-cache and stale temp files.
  The conditional gate matters: this machine runs several concurrent agents
  whose npm installs would break if their content-addressed cache were wiped
  on a schedule; deletion happens only when ENOSPC would otherwise kill the
  soak (SQLite writes fail on a full disk).
#>
param([int]$ThresholdMB = 600)

$root = 'C:\projects\smart-network-monitoring-opencode'
$log  = Join-Path $root 'doc\soak-checkpoints.log'
$free = [math]::Round((Get-PSDrive C).Free / 1MB, 0)

$lines = @("==== disk-guard $(Get-Date -Format o) free=${free}MB ====")

if ($free -lt $ThresholdMB) {
    $before = $free
    Get-ChildItem "$env:LOCALAPPDATA\npm-cache" -Recurse -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem $env:TEMP -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-2) } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $free = [math]::Round((Get-PSDrive C).Free / 1MB, 0)
    $lines += "  below ${ThresholdMB}MB - reclaimed: $before -> $free MB"
}

Add-Content -Path $log -Value ($lines -join "`r`n") -Encoding UTF8
