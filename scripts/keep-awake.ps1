<#
.SYNOPSIS
  Hold the machine awake for N hours — no admin rights required.

.DESCRIPTION
  Calls SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) so Windows
  idle-standback/standby cannot suspend the machine while this process lives,
  then sleeps for the requested duration and releases the hold. Used to
  protect the 24-hour soak run (the soak wrapper tries the same call; this is
  both its standalone twin and a smoke-testable version of the fixed cast).

  Cast note (the bug this exists to avoid): PowerShell parses the hex literal
  0x80000000 as a signed Int32 (-2147483648). Passing that negative number to
  the uint32 P/Invoke parameter throws MethodArgumentConversionInvalidCastArgument,
  and the hold silently never engages. Decimal [uint32] values bind cleanly.

  -SmokeTest: acquire the hold, report success/failure on the pipeline, release
  immediately, exit 0/1. Proves the call works before trusting it for hours.
#>
param(
  [double]$Hours = 25,
  [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS = [uint32]2147483648  # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1      # 0x00000001
$hold = [uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

$result = [Win32.Power]::SetThreadExecutionState($hold)
if ($result -eq 0) {
  Write-Output "HOLD_FAILED SetThreadExecutionState returned 0 at $(Get-Date -Format o)"
  exit 1
}
Write-Output "HOLD_ACQUIRED flags=$hold result=$result at $(Get-Date -Format o) hours=$Hours"

if ($SmokeTest) {
  [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Output "HOLD_RELEASED (smoke test) at $(Get-Date -Format o)"
  exit 0
}

Start-Sleep -Seconds ([int]($Hours * 3600))

[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
Write-Output "HOLD_RELEASED after ${Hours}h at $(Get-Date -Format o)"
exit 0
