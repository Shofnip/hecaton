/**
 * Persistent PowerShell worker for the raw Win32 window operations
 * node-window-manager does not expose: SetParent (with the style strip an embed
 * needs), MoveWindow for an embedded child, ShowWindow, and the WM_APPCOMMAND
 * browser refresh.
 *
 * Etapa 2 shelled these out once per call (~270 ms), which is fine for an embed
 * or a reload but far too slow for positioning: a video-wall screen must follow
 * a panel resize or a focus-divider drag live, dozens of moves a second. So the
 * user32 surface is compiled ONCE here and driven over stdin, the same shape and
 * for the same reason as the WASAPI volume worker (reparenting spike, findings
 * 0.1 and 0.4). Zero npm dependency, no native build.
 *
 * Holds no business rules: it takes hwnds and does exactly what it is told. Which
 * window goes where is the core's decision, relayed by the adapter.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'

/**
 * The user32 surface as C#, wrapped in a stdin line-protocol loop.
 *
 * Style constants and the SetWindowPos flags match the spike's `setchild` /
 * `movescreen`; APPCOMMAND_BROWSER_REFRESH is 3 (18, one off, launches the
 * Calculator — measured the hard way in the spike). movechild re-asserts
 * HWND_TOP after the move because Electron's own input hwnd (it is Chromium too)
 * re-raises itself on a parent resize and would otherwise sit over the embedded
 * child, swallowing clicks (finding 0.1-(2)).
 *
 * Protocol, one command line in -> one reply line out:
 *   reparent <child> <parent>       -> OK parent=<hwnd>
 *   movechild <hwnd> <x> <y> <w> <h> -> OK        (x,y in the parent's client area)
 *   show <hwnd> <cmd>               -> OK         (0 = SW_HIDE, 5 = SW_SHOW)
 *   reload <hwnd>                   -> OK
 *   exists <hwnd>                   -> OK 1 | OK 0
 *   exit                            -> OK  then the process exits
 * Errors reply "ERR <message>". "READY" is printed once the compile is done.
 */
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flag);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);

  const int GWL_STYLE = -16;
  const long WS_CHILD = 0x40000000L;
  const long WS_POPUP = -2147483648L; // 0x80000000
  const long WS_CAPTION = 0x00C00000L;
  const long WS_THICKFRAME = 0x00040000L;
  const long WS_SYSMENU = 0x00080000L;
  const long WS_MINIMIZEBOX = 0x00020000L;
  const long WS_MAXIMIZEBOX = 0x00010000L;
  const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_FRAMECHANGED = 0x0020;
  const uint WM_APPCOMMAND = 0x0319;
  const int APPCOMMAND_BROWSER_REFRESH = 3;

  public static string Reparent(IntPtr child, IntPtr parent) {
    long style = GetWindowLongPtr(child, GWL_STYLE).ToInt64();
    long stripped = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD;
    SetWindowLongPtr(child, GWL_STYLE, (IntPtr)stripped);
    SetParent(child, parent);
    SetWindowPos(child, IntPtr.Zero, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
    return "OK parent=" + GetAncestor(child, 1).ToInt64();
  }

  public static string MoveChild(IntPtr h, int x, int y, int w, int hh) {
    MoveWindow(h, x, y, w, hh, true);
    // Re-assert top of the sibling z-order so Electron's input hwnd cannot cover it.
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    return "OK";
  }

  public static string Show(IntPtr h, int cmd) { ShowWindow(h, cmd); return "OK"; }

  public static string Reload(IntPtr h) {
    SendMessage(h, WM_APPCOMMAND, h, (IntPtr)(APPCOMMAND_BROWSER_REFRESH << 16));
    return "OK";
  }

  public static string Exists(IntPtr h) { return IsWindow(h) ? "OK 1" : "OK 0"; }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp | Out-Null

function Reply([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
Reply 'READY'

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Trim() -split ' '
  try {
    switch ($a[0]) {
      'reparent'  { Reply ([W]::Reparent([IntPtr][int64]$a[1], [IntPtr][int64]$a[2])) }
      'movechild' { Reply ([W]::MoveChild([IntPtr][int64]$a[1], [int]$a[2], [int]$a[3], [int]$a[4], [int]$a[5])) }
      'show'      { Reply ([W]::Show([IntPtr][int64]$a[1], [int]$a[2])) }
      'reload'    { Reply ([W]::Reload([IntPtr][int64]$a[1])) }
      'exists'    { Reply ([W]::Exists([IntPtr][int64]$a[1])) }
      'exit'      { Reply 'OK'; exit 0 }
      default     { Reply "ERR unknown: $($a[0])" }
    }
  } catch {
    Reply ("ERR " + ($_.Exception.Message -replace "\`r|\`n", ' '))
  }
}
`

/** One pending command waiting for its single reply line. */
interface Pending {
  resolve: (reply: string) => void
  reject: (error: Error) => void
}

/**
 * A long-lived PowerShell process compiled with the user32 surface, driven one
 * command line at a time.
 *
 * Same plumbing as the WASAPI worker (a strict line protocol, one command in
 * flight, transparent re-start on death), in a second package because a
 * window-manager adapter cannot reach into browser-engine. Positioning uses it
 * fire-and-forget through the adapter — the port is synchronous — so the queue
 * drains in order (a reparent is always processed before the moves that follow
 * it) without blocking the caller.
 */
export class Win32Worker {
  private proc: ChildProcessWithoutNullStreams | undefined
  private rl: ReadlineInterface | undefined
  private ready: Promise<void> | undefined
  private readonly queue: Pending[] = []
  private disposed = false

  /** Sends one command line and resolves with the reply after "OK ". */
  async send(command: string): Promise<string> {
    if (this.disposed) throw new Error('win32 worker disposed')
    await this.ensureStarted()
    const proc = this.proc
    if (!proc) throw new Error('win32 worker not running')
    const reply = await new Promise<string>((resolve, reject) => {
      this.queue.push({ resolve, reject })
      proc.stdin.write(command + '\n')
    })
    if (!reply.startsWith('OK')) throw new Error(`win32 worker: ${reply} (for: ${command})`)
    return reply.length > 3 ? reply.slice(3) : ''
  }

  /**
   * Warms the worker up front so the first embed does not pay the compile.
   * Overlaps app start-up; never throws — the first command starts it instead.
   */
  start(): Promise<void> {
    return this.ensureStarted()
  }

  private ensureStarted(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = this.boot()
    return this.ready
  }

  private boot(): Promise<void> {
    // -EncodedCommand, not -Command: the embedded C# is full of double quotes,
    // which PowerShell strips out of a -Command string (docs/troubleshooting.md).
    const encoded = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64')
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
      },
    )
    this.proc = proc

    return new Promise<void>((resolve, reject) => {
      let started = false
      const rl = createInterface({ input: proc.stdout })
      this.rl = rl
      rl.on('line', (line) => {
        if (!started && line.trim() === 'READY') {
          started = true
          resolve()
          return
        }
        this.queue.shift()?.resolve(line)
      })
      const fail = (error: Error): void => {
        this.teardown(error)
        if (!started) reject(error)
      }
      proc.on('error', fail)
      proc.on('exit', () => fail(new Error('win32 worker exited')))
    })
  }

  /** Drops the dead process and rejects anything still waiting on it. */
  private teardown(error: Error): void {
    this.proc = undefined
    this.rl?.close()
    this.rl = undefined
    if (!this.disposed) this.ready = undefined
    for (const pending of this.queue.splice(0)) pending.reject(error)
  }

  /** Stops the worker for good. After this the adapter must not be reused. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const proc = this.proc
    if (proc) {
      try {
        await this.sendRaw('exit')
      } catch {
        // Already gone, or never came up: kill covers it.
      }
      proc.kill()
    }
    this.teardown(new Error('win32 worker disposed'))
  }

  /** Best-effort send that tolerates a worker already going away. */
  private async sendRaw(command: string): Promise<void> {
    const proc = this.proc
    if (!proc || !this.ready) return
    await this.ready
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve: () => resolve(), reject })
      proc.stdin.write(command + '\n')
    })
  }
}
