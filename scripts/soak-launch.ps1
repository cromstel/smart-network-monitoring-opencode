<#
.SYNOPSIS
  Launch wrapper for the single-process 24-hour soak (PRD section 7 / B-64), attempt 3.

.DESCRIPTION
  Rebuilt after attempts 1 and 2 were both killed by *other* processes on this
  machine (see doc/TODO.md B-64). Threat model found by forensics of
  opencode.log:
    T1. Another opencode instance ran a cleanup script:
        `Get-Process "node" | Stop-Process -Force` - killed attempt 1 after
        98 min. Counter: the soak runs as data\node-soak.exe (a renamed copy of
        node.exe), so name-based sweeps for "node" do not match it.
    T2. Attempt 2 died in 3 min with STATUS_CONTROL_C_EXIT (0xC000013A), i.e.
        a console control/close event reached the process tree. Counters:
          - the soak child is started with DETACHED_PROCESS: it owns NO
            console at all, so no console signal can ever reach it;
          - this wrapper calls SetConsoleCtrlHandler(NULL, TRUE) so CTRL_C /
            CTRL_BREAK sent to the wrapper's (hidden task) console are ignored.
    T3. npm/npx in the launch chain would spawn plain "node" processes again
        (defeating T1's rename). Counter: no npm - node runs ts-node's
        dist/bin.js directly, which executes scripts/soak.ts IN-PROCESS. The
        whole soak is exactly one process: node-soak.exe.

  Structure (attempt 3):
    - Run by Task Scheduler (SNM-Soak-Launch) -> outside opencode's tree, so an
      opencode server restart cannot kill it (that killed attempt 1's siblings).
    - Wrapper holds ES_CONTINUOUS | ES_SYSTEM_REQUIRED for its lifetime
      (no-admin keep-awake; powercfg AC timeouts are separately set to never).
    - Wrapper truncates out.log/err.log once (single truncate owner), writes
      its start line, then hands FILE_APPEND_DATA handles to the detached
      child and blocks in WaitForSingleObject. When the soak exits the
      wrapper appends "wrapper soak exit=<code> elapsed=..." so a 3am death is
      distinguishable from a clean 1440-minute completion.
    - Environment mirrors .github/workflows/soak.yml: SOAK_MINUTES=1440,
      60s sampling, 30s scans, placeholder SESSION_SECRET/ENCRYPTION_KEY,
      NODE_OPTIONS=--expose-gc, DB_FILE=./data/soak.db.

  Smoke testing: -Minutes N shortens the run (SOAK_MINUTES=N) and -OutLog/
  -ErrLog redirect to distinct files so a smoke never touches the real logs.
  -RepoRoot, -OutLog, -ErrLog default to this repository and today's logs.
#>
param(
  # Defaults to the repository this script lives in, derived from its own
  # location. The absolute path that used to be written here meant the harness
  # only ran from one machine, and a fresh checkout silently logged to a
  # directory that did not exist.
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$Minutes = 1440,
  [string]$OutLog = '',
  [string]$ErrLog = '',
  [switch]$Smoke
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SoakHost
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public int dwFillAttribute, dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(
        string app, string cmd, IntPtr procAttr, IntPtr threadAttr,
        bool inheritHandles, uint flags, IntPtr env, string cwd,
        ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(
        string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa,
        uint disposition, uint attrs, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr handle, out uint code);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    const uint DETACHED_PROCESS   = 0x00000008;
    const uint GENERIC_WRITE      = 0x40000000;
    const uint FILE_APPEND_DATA   = 0x00000004;
    const uint FILE_SHARE_READ    = 0x00000001;
    const uint OPEN_ALWAYS        = 4;
    const uint FILE_ATTR_NORMAL   = 0x00000080;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint INFINITE           = 0xFFFFFFFF;

    // T2 counter: ignore CTRL_C / CTRL_BREAK aimed at this wrapper's console.
    // (CTRL_CLOSE / logoff / shutdown cannot be ignored by design; the task's
    // console is hidden and nothing on this machine is known to close consoles
    // - attempt 2's signature is consistent with a control *signal*.)
    public static bool IgnoreCtrlEvents()
    {
        return SetConsoleCtrlHandler(IntPtr.Zero, true);
    }

    static IntPtr OpenAppend(string path)
    {
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;
        IntPtr h = CreateFileW(path, GENERIC_WRITE | FILE_APPEND_DATA,
            FILE_SHARE_READ, ref sa, OPEN_ALWAYS, FILE_ATTR_NORMAL, IntPtr.Zero);
        if (h == (IntPtr)(-1))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),
                "cannot open " + path);
        return h;
    }

    // Starts exe detached (NO console - immune to console control events),
    // wiring the two append handles as the child's stdout/stderr, then blocks
    // until the child exits and returns its exit code.
    public static int RunDetached(string exe, string args, string cwd,
                                  string outPath, string errPath)
    {
        IntPtr hOut = OpenAppend(outPath);
        IntPtr hErr = OpenAppend(errPath);
        try
        {
            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = (int)STARTF_USESTDHANDLES;
            si.hStdInput = IntPtr.Zero;
            si.hStdOutput = hOut;
            si.hStdError = hErr;

            PROCESS_INFORMATION pi;
            string cmdline = "\"" + exe + "\" " + args;
            bool ok = CreateProcess(null, cmdline, IntPtr.Zero, IntPtr.Zero,
                true, DETACHED_PROCESS, IntPtr.Zero, cwd, ref si, out pi);
            int lastErr = Marshal.GetLastWin32Error();
            if (!ok)
                throw new System.ComponentModel.Win32Exception(lastErr,
                    "CreateProcess failed for " + exe);
            CloseHandle(hOut); hOut = IntPtr.Zero;
            CloseHandle(hErr); hErr = IntPtr.Zero;
            CloseHandle(pi.hThread);
            WaitForSingleObject(pi.hProcess, INFINITE);
            uint code;
            GetExitCodeProcess(pi.hProcess, out code);
            CloseHandle(pi.hProcess);
            return unchecked((int)code);
        }
        finally
        {
            if (hOut != IntPtr.Zero) CloseHandle(hOut);
            if (hErr != IntPtr.Zero) CloseHandle(hErr);
        }
    }
}
'@

# --- keep-awake (belt 2 of 2; powercfg AC timeouts are belt 1) ---------------
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS = [uint32]2147483648        # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1            # 0x00000001
# NOTE: decimal, not 0x80000000 literals - PowerShell parses 0x80000000 as a
# *signed* Int32 (-2147483648), and the negative value makes the P/Invoke
# uint32 conversion throw MethodArgumentConversionInvalidCastArgument
# (this exact bug cost an earlier attempt its 25h holder).

if (-not $OutLog) { $OutLog = Join-Path $RepoRoot 'doc\soak-2026-10-14.out.log' }
if (-not $ErrLog) { $ErrLog = Join-Path $RepoRoot 'doc\soak-2026-10-14.err.log' }

Set-Location $RepoRoot

# Single truncate owner: this WriteAllText runs once, before any handle for
# the child exists (the earlier merged-redirect race that killed an attempt).
[void][IO.File]::WriteAllText($OutLog, '')
[void][IO.File]::WriteAllText($ErrLog, '')

$start = Get-Date
$startLine = 'wrapper start {0} pid={1} SOAK_MINUTES={2} sample=60000ms scan=30000ms mode={3}' -f `
    $start.ToString('o'), $PID, $Minutes, $(if ($Smoke) { 'smoke' } else { 'full' })
[IO.File]::AppendAllText($OutLog, $startLine + "`n")

# --- environment: mirrors .github/workflows/soak.yml ------------------------
$env:SESSION_SECRET = 'soak-session-secret-not-for-production-000000'
$env:ENCRYPTION_KEY = 'soak-encryption-key-not-for-production-00000000'
$env:SOAK_MINUTES   = [string]$Minutes
$env:SOAK_SAMPLE_MS = '60000'
$env:SOAK_SCAN_MS   = '30000'
$env:DB_FILE        = './data/soak.db'
$env:NODE_OPTIONS   = '--expose-gc'

$nodeExe = Join-Path $RepoRoot 'data\node-soak.exe'
if (-not (Test-Path $nodeExe)) {
    Copy-Item (Join-Path (Split-Path (Get-Command node).Source) 'node.exe') $nodeExe
}
$tsBin = Join-Path $RepoRoot 'node_modules\ts-node\dist\bin.js'
$args = '-r tsconfig-paths/register "' + $tsBin + '" --project tsconfig.node.json scripts\soak.ts'

$hold = [uint32]0
$exit = -1
try {
    [void][SoakHost]::IgnoreCtrlEvents()
    $hold = [uint32]([Win32.Power]::SetThreadExecutionState(($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)))
    $exit = [SoakHost]::RunDetached($nodeExe, $args, $RepoRoot, $OutLog, $ErrLog)
} catch {
    [IO.File]::AppendAllText($ErrLog, "wrapper launch failure: $($_.Exception.Message)`n")
    $exit = -99
} finally {
    [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}

$elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
[IO.File]::AppendAllText($OutLog,
    ('wrapper soak exit={0} elapsed={1}min ended={2}' -f $exit, $elapsed, (Get-Date).ToString('o')) + "`n")
exit $exit
