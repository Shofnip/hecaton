/**
 * Audio adapter: per-process mute over the Windows Core Audio API (WASAPI).
 *
 * The core asks to mute a slot by its main pid. On Windows the sound a slot
 * makes belongs to a child "audio service" process Chrome spawns, not to the
 * browser process itself, so this adapter maps the main pid to that child — the
 * one whose parent is the main pid — and mutes its audio session. That mapping
 * is the OS detail ADR-0010 keeps out of the core, exactly as the window
 * adapter keeps the invisible-border arithmetic out of it.
 *
 * No npm dependency and no native build: the Core Audio interfaces are declared
 * inline as C# and driven through PowerShell, the same shape dwm-insets.ts uses
 * for DWM. It shells out once per mute change — measured at ~270ms — which is
 * the latency ADR-0010 accepts in exchange for adding no supply-chain surface.
 *
 * Holds no business rules: which slot is muted, and when, is the orchestrator's
 * decision. This only carries it out.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AudioController } from '@helloweb/core'

const run = promisify(execFile)

/** Mute, unmute, or read without changing — the three things the script does. */
const enum Action {
  Unmute = 0,
  Mute = 1,
  Query = 2,
}

/**
 * The Core Audio COM surface, plus a Toolhelp parent-pid lookup, as C#.
 *
 * Verified against real Chrome slots in the Phase 1.5 spike: each slot exposes
 * its own audio session, identifiable through the audio-service child whose
 * parent is the slot's browser pid, and muting one leaves the others — and the
 * user's own Chrome — untouched.
 */
const CSHARP = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

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
    int RegisterSessionNotification(IntPtr n);
    int UnregisterSessionNotification(IntPtr n);
    int RegisterDuckNotification(IntPtr s, IntPtr n);
    int UnregisterDuckNotification(IntPtr n);
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

    // action: 0 unmute, 1 mute, 2 query only.
    public static void Run(int target, int action) {
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
      int hits = 0;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 c;
        sessions.GetSession(i, out c);
        uint pid; c.GetProcessId(out pid);
        if (!BelongsTo(pid, (uint)target, parents)) continue;
        var vol = (ISimpleAudioVolume)c;
        if (action != 2) vol.SetMute(action == 1, IntPtr.Zero);
        bool muted; vol.GetMute(out muted);
        Console.WriteLine("STATE pid=" + pid + " muted=" + muted);
        hits++;
      }
      Console.WriteLine("SESSIONS=" + hits);
    }
  }
}
`

/** Wraps the C# in a PowerShell here-string and the call that runs it. */
function scriptFor(target: number, action: Action): string {
  // target and action are integers this code controls, so interpolating them as
  // numeric literals is safe. The closing '@ must sit at column 0.
  return `$cs = @'\n${CSHARP}\n'@\nAdd-Type -TypeDefinition $cs -Language CSharp | Out-Null\n[Helloweb.Audio]::Run(${target}, ${action})\n`
}

async function invoke(target: number, action: Action): Promise<string> {
  // -EncodedCommand, not -Command: the C# is full of double quotes, which
  // PowerShell strips out of a -Command string. This repo has hit that trap
  // repeatedly; docs/troubleshooting.md records it.
  const encoded = Buffer.from(scriptFor(target, action), 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  )
  return stdout
}

export class WasapiAudioController implements AudioController {
  async setMuted(pid: number, muted: boolean): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
    try {
      await invoke(pid, muted ? Action.Mute : Action.Unmute)
    } catch {
      // Best effort: a slot with no session yet (nothing has played), or a
      // transient COM failure, must not crash the focus loop. The next focus
      // tick applies the desired state again.
    }
  }

  /**
   * The mute state of the slot's audio session, or undefined when it has none.
   * Diagnostics and the integration suite only — the core never reads state, it
   * only sets it.
   */
  async probeMuted(pid: number): Promise<boolean | undefined> {
    let stdout: string
    try {
      stdout = await invoke(pid, Action.Query)
    } catch {
      return undefined
    }
    const match = /STATE pid=\d+ muted=(True|False)/.exec(stdout)
    if (!match) return undefined
    return match[1] === 'True'
  }
}
