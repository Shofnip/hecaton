/**
 * Raw Win32 operations node-window-manager does not expose: SetParent (with the
 * style strip an embed needs), ShowWindow, and the WM_APPCOMMAND browser
 * refresh.
 *
 * node-window-manager only moves and reads top-level windows. The video wall
 * needs three things it has no API for — embedding a foreign window into the
 * panel, hiding/showing it, and reloading its page in place — and all three are
 * a couple of user32 calls. They are shelled out to PowerShell the same way
 * dwm-insets.ts shells out to DWM: self-contained C#, no npm dependency, no
 * native build. Each was validated against real Chrome in the reparenting spike
 * (docs/plans/ui-rework.md, Step 0), whose exact call shapes this mirrors.
 *
 * These run at human cadence — an embed once per launch, a hide/show on a focus
 * toggle, a reload on a click — so a per-call shell-out (~270 ms) is the right
 * trade, unlike the volume slider, which earned the persistent worker.
 *
 * Holds no business rules: it takes hwnds and does exactly what it is told.
 */
import { execFileSync } from 'node:child_process'

/**
 * The user32 surface, as C#. Style constants and the SetWindowPos flags match
 * the spike's `setchild`; APPCOMMAND_BROWSER_REFRESH is 3 (18, the value one
 * off, launches the Calculator — measured the hard way in the spike).
 */
const CSHARP = `
using System;
using System.Runtime.InteropServices;
public static class Win32Ops {
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flag);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);

  const int GWL_STYLE = -16;
  const long WS_CHILD = 0x40000000L;
  const long WS_POPUP = 0x80000000L;
  const long WS_CAPTION = 0x00C00000L;
  const long WS_THICKFRAME = 0x00040000L;
  const long WS_SYSMENU = 0x00080000L;
  const long WS_MINIMIZEBOX = 0x00020000L;
  const long WS_MAXIMIZEBOX = 0x00010000L;
  const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_FRAMECHANGED = 0x0020;
  const uint WM_APPCOMMAND = 0x0319;
  const int APPCOMMAND_BROWSER_REFRESH = 3;

  // Reparent a spawned Chrome window into the panel: strip the top-level frame
  // styles and add WS_CHILD before SetParent, then force a frame recalc. Returns
  // the child's parent afterwards, so the caller can confirm the embed took.
  public static string Reparent(IntPtr child, IntPtr parent) {
    long style = GetWindowLongPtr(child, GWL_STYLE).ToInt64();
    long stripped = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD;
    SetWindowLongPtr(child, GWL_STYLE, (IntPtr)stripped);
    SetParent(child, parent);
    SetWindowPos(child, IntPtr.Zero, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
    return "OK parent=" + GetAncestor(child, 1).ToInt64();
  }

  public static string Show(IntPtr h, int cmd) { ShowWindow(h, cmd); return "OK"; }

  // In-tab reload via the media-keyboard refresh path, handled by Chrome without
  // keyboard focus — the one recovery that preserves the tab-bound login.
  public static string Reload(IntPtr h) {
    SendMessage(h, WM_APPCOMMAND, h, (IntPtr)(APPCOMMAND_BROWSER_REFRESH << 16));
    return "OK";
  }

  public static string Exists(IntPtr h) { return IsWindow(h) ? "OK 1" : "OK 0"; }
}
`

/** SW_HIDE and SW_SHOW, the two ShowWindow commands the video wall uses. */
const SW_HIDE = 0
const SW_SHOW = 5

/**
 * Runs one Win32Ops call and returns its single output line.
 *
 * -EncodedCommand rather than -Command: the C# is full of double quotes, which
 * PowerShell strips out of a -Command string — the trap this repo keeps hitting
 * (docs/troubleshooting.md). Undefined on any failure; the caller decides what
 * an unusable window means.
 */
function invoke(call: string): string | undefined {
  const script = `
$cs = @'
${CSHARP}
'@
Add-Type -TypeDefinition $cs -Language CSharp | Out-Null
${call}
`
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      // Silence stderr: Add-Type writes a progress record there that would
      // otherwise leak into the running app's console.
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return undefined
  }
}

/**
 * Embeds `childHwnd` into `parentHwnd`. Returns true when the child's parent is
 * the panel afterwards — the same check the spike used to confirm the embed.
 */
export function reparentWindow(childHwnd: number, parentHwnd: number): boolean {
  const out = invoke(`[Win32Ops]::Reparent([IntPtr]${childHwnd}, [IntPtr]${parentHwnd})`)
  return out === `OK parent=${parentHwnd}`
}

/** Hides an embedded window (SW_HIDE). */
export function hideWindow(hwnd: number): boolean {
  return invoke(`[Win32Ops]::Show([IntPtr]${hwnd}, ${SW_HIDE})`)?.startsWith('OK') ?? false
}

/** Shows a hidden embedded window again (SW_SHOW). */
export function showWindow(hwnd: number): boolean {
  return invoke(`[Win32Ops]::Show([IntPtr]${hwnd}, ${SW_SHOW})`)?.startsWith('OK') ?? false
}

/** Reloads the page in place via WM_APPCOMMAND / APPCOMMAND_BROWSER_REFRESH. */
export function reloadWindow(hwnd: number): boolean {
  return invoke(`[Win32Ops]::Reload([IntPtr]${hwnd})`)?.startsWith('OK') ?? false
}

/** Whether the handle still refers to a live window — used to drop stale hwnds. */
export function windowExists(hwnd: number): boolean {
  return invoke(`[Win32Ops]::Exists([IntPtr]${hwnd})`) === 'OK 1'
}
