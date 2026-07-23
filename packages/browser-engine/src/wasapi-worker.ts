/**
 * Persistent PowerShell worker for the Windows Core Audio API (WASAPI).
 *
 * The mute adapter used to shell out once per change — ~270 ms, dominated by
 * PowerShell start-up and the Add-Type compile of the COM surface. That is fine
 * for a mute toggle but not for a volume slider drag, which fires dozens of
 * changes a second. The reparenting spike (item 0.4) measured the fix: compile
 * the same COM surface ONCE in a long-lived PowerShell process and drive it
 * over stdin — avg 12 ms, p95 13 ms per change, ~20x under the shell-out.
 *
 * Zero npm dependency and no native build, exactly as the per-call shell-out
 * was (ADR-0010): the Core Audio interfaces are declared inline as C#. The only
 * change is where the compile happens — once, here, instead of every call.
 *
 * Holds no business rules. Which slot is muted or how loud, and when, is the
 * orchestrator's decision; this only carries it out and maps the slot's browser
 * pid to the audio-service child that actually owns the session.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'

/**
 * The Core Audio COM surface plus a Toolhelp parent-pid lookup, as C#, wrapped
 * in a stdin line-protocol loop.
 *
 * The COM surface is the mute adapter's, unchanged — same GUIDs, same
 * child-pid-to-parent mapping validated in the Phase 1.5 spike — extended so a
 * single Run also sets and reads ISimpleAudioVolume.SetMasterVolume, the volume
 * half the reparenting spike added.
 *
 * Protocol, one command line in -> one reply line out:
 *   mute <pid>          -> OK SESSIONS=n[ pid=.. muted=.. vol=..]...
 *   unmute <pid>        -> OK ...
 *   query <pid>         -> OK ...            (reads without changing)
 *   vol <pid> <0-100>   -> OK ...            (sets master volume)
 *   getvol <pid>        -> OK ...            (reads without changing)
 *   exit                -> OK  then the process exits
 * Errors reply "ERR <message>". "READY" is printed once the compile is done.
 */
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Helloweb {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int state, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IntPtr store);
    int GetId(out IntPtr id);
    int GetState(out int state);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr g, int f, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    int GetState(out int s);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr e);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string p, IntPtr e);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, IntPtr e);
    int RegisterAudioSessionNotification(IntPtr n);
    int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISimpleAudioVolume {
    int SetMasterVolume(float l, IntPtr e);
    int GetMasterVolume(out float l);
    int SetMute(bool m, IntPtr e);
    int GetMute(out bool m);
  }

  public static class Audio {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct PROCESSENTRY32 {
      public uint dwSize; public uint cntUsage; public uint th32ProcessID;
      public IntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads;
      public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool Process32First(IntPtr s, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool Process32Next(IntPtr s, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);

    // child pid -> parent pid, so a session's audio-service process can be traced
    // back to the slot's browser process.
    static Dictionary<uint, uint> Parents() {
      var map = new Dictionary<uint, uint>();
      IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0);
      if (snap == (IntPtr)(-1)) return map;
      try {
        var e = new PROCESSENTRY32();
        e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32First(snap, ref e)) {
          do { map[e.th32ProcessID] = e.th32ParentProcessID; } while (Process32Next(snap, ref e));
        }
      } finally { CloseHandle(snap); }
      return map;
    }

    // A session belongs to the slot when it is the browser process itself or a
    // direct child of it (the audio-service utility process).
    static bool BelongsTo(uint sessionPid, uint target, Dictionary<uint, uint> parents) {
      if (sessionPid == 0) return false;
      if (sessionPid == target) return true;
      uint parent;
      return parents.TryGetValue(sessionPid, out parent) && parent == target;
    }

    // action: 0 unmute, 1 mute, 2 query, 3 set volume, 4 read volume.
    // level is a 0..1 master volume, used only when action == 3.
    public static string Run(int target, int action, float level) {
      var parents = Parents();
      var enumr = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDevice dev;
      enumr.GetDefaultAudioEndpoint(0, 0, out dev);
      var iid = typeof(IAudioSessionManager2).GUID;
      object mgrObj;
      dev.Activate(ref iid, 1, IntPtr.Zero, out mgrObj);
      var mgr = (IAudioSessionManager2)mgrObj;
      IAudioSessionEnumerator sessions;
      mgr.GetSessionEnumerator(out sessions);
      int count; sessions.GetCount(out count);
      var outp = new StringBuilder();
      int hits = 0;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 c;
        sessions.GetSession(i, out c);
        uint pid; c.GetProcessId(out pid);
        if (!BelongsTo(pid, (uint)target, parents)) continue;
        var vol = (ISimpleAudioVolume)c;
        if (action == 0 || action == 1) vol.SetMute(action == 1, IntPtr.Zero);
        if (action == 3) vol.SetMasterVolume(level, IntPtr.Zero);
        bool muted; vol.GetMute(out muted);
        float now; vol.GetMasterVolume(out now);
        outp.Append(" pid=" + pid + " muted=" + muted +
          " vol=" + now.ToString("0.00", CultureInfo.InvariantCulture));
        hits++;
      }
      return "SESSIONS=" + hits + outp.ToString();
    }
  }
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
      'mute'   { Reply ("OK " + [Helloweb.Audio]::Run([int]$a[1], 1, 0.0)) }
      'unmute' { Reply ("OK " + [Helloweb.Audio]::Run([int]$a[1], 0, 0.0)) }
      'query'  { Reply ("OK " + [Helloweb.Audio]::Run([int]$a[1], 2, 0.0)) }
      'vol'    { Reply ("OK " + [Helloweb.Audio]::Run([int]$a[1], 3, [float]([int]$a[2] / 100.0))) }
      'getvol' { Reply ("OK " + [Helloweb.Audio]::Run([int]$a[1], 4, 0.0)) }
      'exit'   { Reply 'OK'; exit 0 }
      default  { Reply "ERR unknown: $($a[0])" }
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
 * A long-lived PowerShell process compiled with the WASAPI COM surface, driven
 * one command line at a time.
 *
 * One command is in flight at a time (a strict line protocol: reply N belongs
 * to command N), so callers are serialised through an internal queue. The
 * process is started lazily and re-started transparently if it dies: a crashed
 * worker rejects its in-flight calls, and the next call spawns a fresh one, so
 * a transient failure costs one command, not the adapter.
 */
export class WasapiWorker {
  private proc: ChildProcessWithoutNullStreams | undefined
  private rl: ReadlineInterface | undefined
  private ready: Promise<void> | undefined
  private readonly queue: Pending[] = []
  private disposed = false

  /** Sends one command line and resolves with the reply after "OK ". */
  async send(command: string): Promise<string> {
    if (this.disposed) throw new Error('wasapi worker disposed')
    await this.ensureStarted()
    const proc = this.proc
    if (!proc) throw new Error('wasapi worker not running')
    const reply = await new Promise<string>((resolve, reject) => {
      this.queue.push({ resolve, reject })
      proc.stdin.write(command + '\n')
    })
    if (!reply.startsWith('OK')) throw new Error(`wasapi worker: ${reply} (for: ${command})`)
    // "OK" alone (the exit reply) or "OK <payload>".
    return reply.length > 3 ? reply.slice(3) : ''
  }

  /**
   * Warms the worker up front so the first real command does not pay the ~680 ms
   * compile. Overlaps app start-up (the spike's finding 0.4). Never throws — a
   * failed pre-warm just means the first command starts it instead.
   */
  start(): Promise<void> {
    return this.ensureStarted()
  }

  /** Starts the worker if it is not already up, waiting until it reports READY. */
  private ensureStarted(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = this.boot()
    return this.ready
  }

  private boot(): Promise<void> {
    // -EncodedCommand, not -Command: the embedded C# is full of double quotes,
    // which PowerShell strips out of a -Command string — the trap this repo has
    // hit repeatedly (docs/troubleshooting.md). The whole worker, stdin loop and
    // all, rides in as base64.
    const encoded = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64')
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true },
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
        // Every other line is the reply to the head of the queue.
        this.queue.shift()?.resolve(line)
      })
      const fail = (error: Error): void => {
        this.teardown(error)
        if (!started) reject(error)
      }
      proc.on('error', fail)
      proc.on('exit', () => fail(new Error('wasapi worker exited')))
    })
  }

  /** Drops the dead process and rejects anything still waiting on it. */
  private teardown(error: Error): void {
    this.proc = undefined
    this.rl?.close()
    this.rl = undefined
    // A dead worker cannot answer: reject the in-flight commands so callers fall
    // back rather than hang, and clear `ready` so the next call re-spawns.
    if (!this.disposed) this.ready = undefined
    for (const pending of this.queue.splice(0)) pending.reject(error)
  }

  /** Stops the worker for good. After this the controller must not be reused. */
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
    this.teardown(new Error('wasapi worker disposed'))
  }

  /** Best-effort send that tolerates a worker that is already going away. */
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
