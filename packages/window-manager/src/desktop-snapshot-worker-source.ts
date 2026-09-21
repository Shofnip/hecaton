/**
 * A separate persistent process for a focus-triggered desktop read.
 *
 * `node-window-manager.getWindows()` materialises every top-level window before
 * JavaScript can filter it. Even from a Node worker thread that work remained in
 * Electron's process on the exact two-second cadence the owner could feel. This
 * Win32 probe asks only for process ids first, and reads visibility, title and
 * geometry solely for the requested browser windows and the panel handle.
 */
export const DESKTOP_SNAPSHOT_WORKER_SOURCE = `
$ErrorActionPreference = 'Stop'
$cs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class S {
  [DllImport("shcore.dll",EntryPoint="SetProcessDpiAwareness")] public static extern int D(int v);
  delegate bool EW(IntPtr h, IntPtr l);
  delegate bool EM(IntPtr h, IntPtr dc, ref RECT r, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EW cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, EM cb, IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MI i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct MI { public int Size; public RECT Monitor,Work; public uint Flags; }

  public static string Scan(string ids, long panel) {
    var wanted = new HashSet<uint>();
    foreach (var value in ids.Split(',')) { uint pid; if (uint.TryParse(value, out pid)) wanted.Add(pid); }
    var windows = new List<string>();
    EW each = delegate(IntPtr h, IntPtr l) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!wanted.Contains(pid) && h.ToInt64() != panel) return true;
      RECT r; GetWindowRect(h, out r);
      int n = GetWindowTextLength(h);
      var title = new StringBuilder(n + 1);
      if (n > 0) GetWindowText(h, title, title.Capacity);
      windows.Add(String.Join(",", new object[] { h.ToInt64(), pid, IsWindowVisible(h)?1:0,
        String.IsNullOrWhiteSpace(title.ToString())?0:1, r.L, r.T, r.R-r.L, r.B-r.T }));
      return true;
    };
    EnumWindows(each, IntPtr.Zero);
    var monitors = new List<string>();
    EM monitor = delegate(IntPtr h, IntPtr dc, ref RECT r, IntPtr l) {
      var i = new MI(); i.Size = Marshal.SizeOf(typeof(MI));
      if (GetMonitorInfo(h, ref i)) monitors.Add(String.Join(",", new object[] { i.Work.L, i.Work.T, i.Work.R-i.Work.L, i.Work.B-i.Work.T }));
      return true;
    };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, monitor, IntPtr.Zero);
    return String.Join(";", monitors) + "|" + String.Join(";", windows);
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp
[S]::D(2) | Out-Null
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
function Reply([string]$s) { [Console]::Out.WriteLine('OK ' + $s); [Console]::Out.Flush() }
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $a = $line.Split(' ')
  try {
    switch ($a[0]) {
      'scan' { Reply ([S]::Scan($a[1], [int64]$a[2])) }
      'exit' { Reply ''; exit 0 }
      default { [Console]::Out.WriteLine('ERR unknown'); [Console]::Out.Flush() }
    }
  } catch {
    $message = $_.Exception.Message.Replace([char]13, ' ').Replace([char]10, ' ')
    [Console]::Out.WriteLine('ERR ' + $message); [Console]::Out.Flush()
  }
}
`
