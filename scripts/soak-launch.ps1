<#
.SYNOPSIS
  Launch wrapper for the single-process 24-hour soak (PRD §7 / B-64).

.DESCRIPTION
  Why a wrapper instead of a bare `Start-Process npm`:
    1. It holds ES_CONTINUOUS | ES_SYSTEM_REQUIRED for its whole lifetime, so
       Windows idle-standby cannot kill the soak overnight. Works without
       admin rights (powercfg was also set to never sleep on AC; this is the
       belt to that pair of suspenders).
    2. It spawns the soak with NO redirection of its own: the child inherits
       this wrapper's stdout/stderr, which the *outer* launch owns as two
       distinct files. Single file-handle owner per file, so nothing can
       truncate anything else — the failure mode that killed an earlier
       attempt (one merged redirect target).
    3. It prints the soak's exit code and elapsed wall clock when finished,
       so a 3am crash is distinguishable from a clean 1440-minute completion.

  Environment mirrors .github/workflows/soak.yml (same placeholder secrets,
  same 60s sampling / 30s scan cadence); SOAK_MINUTES=1440 is the deliberate
  difference — the real single-process run versus CI's four ~6h segments.
  DB_FILE=./data/soak.db and NODE_OPTIONS=--expose-gc come from the package
  .json "soak" script itself.
#>
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot
)

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS = [uint32]2147483648        # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1            # 0x00000001
# NOTE: decimal, not 0x80000000 literals — PowerShell parses 0x80000000 as a
# *signed* Int32 (-2147483648), and the negative value makes the P/Invoke
# uint32 conversion throw MethodArgumentConversionInvalidCastArgument. That
# exact bug silently voided the keep-awake hold on the first launch; the
# decimal uint32 form binds cleanly.
$esHold = [uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
[void][Win32.Power]::SetThreadExecutionState($esHold)

Set-Location $RepoRoot

$env:SESSION_SECRET = 'soak-session-secret-not-for-production-000000'
$env:ENCRYPTION_KEY  = 'soak-encryption-key-not-for-production-00000000'
$env:SOAK_MINUTES    = '1440'
$env:SOAK_SAMPLE_MS  = '60000'
$env:SOAK_SCAN_MS    = '30000'

Write-Output "wrapper start $(Get-Date -Format o) pid=$PID SOAK_MINUTES=$($env:SOAK_MINUTES) sample=$($env:SOAK_SAMPLE_MS)ms scan=$($env:SOAK_SCAN_MS)ms"

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
# No -RedirectStandard*: child inherits this process's handles, and the outer
# launcher already owns stdout/stderr as distinct files.
$proc = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', 'npm run soak' `
  -WorkingDirectory $RepoRoot `
  -NoNewWindow -PassThru -Wait
$stopwatch.Stop()

Write-Output "wrapper soak exit=$($proc.ExitCode) elapsed=$([int]$stopwatch.Elapsed.TotalMinutes)min ended=$(Get-Date -Format o)"

# Release the keep-awake hold now that the soak is over.
[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
exit $proc.ExitCode
