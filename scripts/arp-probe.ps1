<#
.SYNOPSIS
  PRD S5 "the real /24 probe is not measured" - Windows-host ARP probe.

.DESCRIPTION
  Sweeps an authorised /24 by driving the host OS's neighbour (ARP) resolution
  with a fast ICMP pass, reads the resulting layer-2 table, and enriches each
  MAC with the project's own offline OUI database (node_modules/oui-data - the
  exact source lib/services/oui.ts uses).

  WHY THIS VARIANT EXISTS (measured 2026-10-14, not assumed):
    scripts/arp-probe.sh drives /usr/sbin/arp-scan, but every place that
    binary runs on this machine is behind NAT. WSL2 routes the LAN via
    172.23.224.1 (`ip route get 192.168.1.1`) and its neighbour table stays
    empty for LAN addresses, so the authorised sweep there returned
    "0 responded" on warm-up plus all three timed passes. The only adapter on
    the LAN's layer-2 is the Windows host itself (Wi-Fi, 192.168.1.103/24).

  METHOD AND ITS HONEST LIMITS (disclosure, not a claim of equivalence):
    * The app spawns arp-scan, which emits raw ARP who-has frames. On Windows
      that needs a packet driver (Npcap); it is not installed and its
      installer requires elevation.
    * This probe sends a fast ICMP sweep instead. Transmitting any IP datagram
      at a LAN host forces Windows to ARP-resolve it first - the OS issues the
      same ARP who-has frame arp-scan would - and the reply lands in the same
      neighbour table that `arp -a` / Get-NetNeighbor reads. The (IP, MAC)
      pairs below are therefore genuine ARP-derived entries, not pings.
    * Differences from arp-scan: the OS throttles neighbour resolution
      (slower than arp-scan's burst), discovery does NOT depend on ICMP
      replies (a host that drops echo still answers ARP and is found), and
      the wall-clock number is not comparable to arp-scan's hosts/sec.

  SAFETY RAILS (mirrors scripts/arp-probe.sh; all three non-negotiable):
    1. Refuses to run unless SUBNET is explicitly supplied - there is no
       default. A sweep that guesses its target is a sweep nobody authorised.
    2. Refuses any target that is not RFC1918 space, or that is not a /24.
    3. Refuses to run when this host holds no address inside the target
       subnet - a probe off the segment cannot honestly report on it.

.EXAMPLE
  powershell -File scripts/arp-probe.ps1 192.168.1.0/24
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateNotNullOrEmpty()]
  [string]$Subnet
)

$ErrorActionPreference = 'Stop'

# --- rail 2a: /24 format only (keeps host enumeration well-defined) -------
if ($Subnet -notmatch '^(\d{1,3}\.){3}\d{1,3}/24$') {
  Write-Output "refusing to sweep '$Subnet': only /24 targets are implemented."
  exit 64
}

# --- rail 2b: private ranges only ----------------------------------------
if ($Subnet -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)') {
  Write-Output "refusing to sweep '$Subnet': not a private range."
  Write-Output 'This script only sweeps RFC1918 space on a network you control.'
  exit 64
}

$octets = $Subnet.Split('/')[0].Split('.')
$prefix = '{0}.{1}.{2}' -f [int]$octets[0], [int]$octets[1], [int]$octets[2]

# --- rail 3: this host must be on the segment ----------------------------
$local = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "$prefix.*" } |
  Select-Object -First 1
if (-not $local) {
  Write-Output "refusing to run: this host has no IPv4 address inside $prefix.0/24."
  Write-Output 'The probe must run from a machine on the segment it sweeps.'
  exit 69
}

# --- OUI map, loaded the way lib/services/oui.ts loads it -----------------
$ouiMap = @{}
$ouiPath = Join-Path $PSScriptRoot '..\node_modules\oui-data\index.json'
$ouiSource = 'missing (vendor column will be empty)'
if (Test-Path $ouiPath) {
  $raw = Get-Content $ouiPath -Raw
  foreach ($m in [regex]::Matches($raw, '"([^"]+)"\s*:\s*"([^"]+)"')) {
    $k = ($m.Groups[1].Value -replace '-', '').ToUpper()
    if ($k -match '^[0-9A-F]{6}$') { $ouiMap[$k] = $m.Groups[2].Value }
  }
  $raw = $null
  $ouiSource = "oui-data $((Get-Content (Join-Path $PSScriptRoot '..\node_modules\oui-data\package.json') -Raw | ConvertFrom-Json).version) ($($ouiMap.Count) OUIs)"
}

function Get-Vendor {
  param([string]$Mac)
  $clean = ($Mac -replace '[^0-9A-Fa-f]', '').ToUpper()
  if ($clean.Length -lt 6) { return $null }
  $key = $clean.Substring(0, 6)
  if ($script:ouiMap.ContainsKey($key)) { return $script:ouiMap[$key] }
  return $null
}

# Neighbours on the target subnet with a plausible unicast MAC.
function Get-TargetNeighbors {
  param([string]$Pfx)
  Get-NetNeighbor -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -like "$Pfx.*" -and
      $_.LinkLayerAddress -and
      $_.LinkLayerAddress -match '^([0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}$' -and
      $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and
      $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' -and
      $_.State -ne 'Unreachable'
    }
}

$started = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
$before = @(Get-TargetNeighbors -Pfx $prefix)

Write-Output 'ARP /24 probe - Windows host variant'
Write-Output '====================================='
Write-Output "target      $Subnet"
Write-Output "adapter     $($local.InterfaceAlias) $($local.IPAddress)/$($local.PrefixLength)"
Write-Output 'binary      none - OS neighbour resolution (arp-scan needs Npcap here)'
Write-Output "oui         $ouiSource"
Write-Output "started     $started"
Write-Output ''
Write-Output "pre-sweep ARP cache: $($before.Count) neighbours on target subnet"
Write-Output ''

# --- the sweep: one Ping per target, batches of 64, 700ms timeout --------
$targets = @(1..254 | ForEach-Object { '{0}.{1}' -f $prefix, $_ } | Where-Object { $_ -ne $local.IPAddress })
$alive = New-Object 'System.Collections.Generic.HashSet[string]'
$batchSize = 64
$timeoutMs = 700

$sw = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $targets.Count; $i += $batchSize) {
  $end = [Math]::Min($i + $batchSize - 1, $targets.Count - 1)
  $batch = @($targets[$i..$end])
  $tasks = foreach ($ip in $batch) {
    $p = [System.Net.NetworkInformation.Ping]::new()
    [pscustomobject]@{
      IP   = $ip
      Ping = $p
      Task = $p.SendPingAsync([System.Net.IPAddress]::Parse($ip), $timeoutMs)
    }
  }
  foreach ($t in $tasks) {
    try {
      if ($t.Task.Wait($timeoutMs + 2000) -and
          $t.Task.Result.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
        [void]$alive.Add($t.IP)
      }
    } catch {
      # Host filtered the echo or resolution failed; the ARP side effect of
      # *sending* it already happened either way.
    } finally {
      $t.Ping.Dispose()
    }
  }
}
$sw.Stop()

# Let throttled neighbour resolutions finish, then read twice so late
# completions are not missed.
Start-Sleep -Seconds 2
$pass1 = @(Get-TargetNeighbors -Pfx $prefix)
Start-Sleep -Seconds 2
$pass2 = @(Get-TargetNeighbors -Pfx $prefix)

$union = @{}
foreach ($n in ($pass1 + $pass2)) { $union[$n.IPAddress] = $n }
$post = @($union.Values | Sort-Object { [version]$_.IPAddress })

$beforeSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($n in $before) { [void]$beforeSet.Add($n.IPAddress) }
$new = @($post | Where-Object { -not $beforeSet.Contains($_.IPAddress) })

Write-Output '-- sweep --'
Write-Output "sent       $($targets.Count) probes ($batchSize concurrent, ${timeoutMs}ms timeout)"
Write-Output "wall clock $($sw.ElapsedMilliseconds)ms"
Write-Output "ICMP replies $($alive.Count)"
Write-Output ''
Write-Output '-- ARP neighbours after sweep --'
Write-Output "total      $($post.Count)  (pre-sweep $($before.Count), newly resolved $($new.Count))"
Write-Output ''
Write-Output ('{0,-15} {1,-18} {2,-6} {3,-10} {4}' -f 'IP', 'MAC', 'ICMP', 'state', 'vendor')
Write-Output ('-' * 78)
foreach ($n in $post) {
  $macColon = $n.LinkLayerAddress -replace '-', ':'
  $icmp = if ($alive.Contains($n.IPAddress)) { 'yes' } else { 'no' }
  $vendor = Get-Vendor $n.LinkLayerAddress
  if (-not $vendor) { $vendor = '-' }
  Write-Output ('{0,-15} {1,-18} {2,-6} {3,-10} {4}' -f $n.IPAddress, $macColon, $icmp, $n.State, $vendor)
}

Write-Output ''
Write-Output "finished   $(Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')"
Write-Output ''
Write-Output 'Note: layer-2 discovery on a network you control. ARP who-has only -'
Write-Output 'no login attempts, no port scanning, no payloads.'
exit 0
