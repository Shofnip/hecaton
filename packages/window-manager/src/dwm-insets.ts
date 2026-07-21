/**
 * The gap between the rectangle Windows stores for a window and the rectangle
 * the user sees.
 *
 * Windows 10 and 11 include an invisible resize border in a window's rect. On a
 * 100% scaled display it measures 7px on the left, right and bottom and 0 on
 * top. Positioning windows by that rect is what made a grid that provably
 * covers the screen exactly show visible gaps: 7px at each screen edge and 14px
 * between neighbours, since each contributed its own margin.
 *
 * The margin scales with DPI, so it is measured rather than assumed — a
 * constant would be correct only on the machine it was measured on, and this
 * app is distributed.
 */
import { execFileSync } from 'node:child_process'

export interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

export const NO_INSETS: Insets = { left: 0, top: 0, right: 0, bottom: 0 }

/**
 * Asks Windows for both rectangles of one window.
 *
 * Passed as -EncodedCommand rather than -Command. The C# below is full of
 * double quotes, and PowerShell eats those out of a -Command string before the
 * shell ever sees them — a trap this repository has now hit three times, and
 * which `docs/troubleshooting.md` documents. Base64 removes the question.
 */
function queryRects(hwnd: number): { window: Insets; extended: Insets } | undefined {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class HellowebFrame {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("dwmapi.dll")]
  private static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int c);
  [DllImport("user32.dll")]
  private static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static string Get(IntPtr h) {
    RECT w; GetWindowRect(h, out w);
    RECT e;
    // 9 = DWMWA_EXTENDED_FRAME_BOUNDS, the painted rectangle.
    int hr = DwmGetWindowAttribute(h, 9, out e, Marshal.SizeOf(typeof(RECT)));
    if (hr != 0) { return "err"; }
    return w.Left + "," + w.Top + "," + w.Right + "," + w.Bottom + ";" +
           e.Left + "," + e.Top + "," + e.Right + "," + e.Bottom;
  }
}
'@
[HellowebFrame]::Get([IntPtr]${hwnd})
`
  let stdout: string
  try {
    stdout = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8' },
    )
  } catch {
    return undefined
  }

  const [windowRect, extendedRect] = stdout.trim().split(';')
  if (!windowRect || !extendedRect) return undefined

  const parse = (raw: string): Insets | undefined => {
    const parts = raw.split(',').map(Number)
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return undefined
    return { left: parts[0]!, top: parts[1]!, right: parts[2]!, bottom: parts[3]! }
  }

  const window = parse(windowRect)
  const extended = parse(extendedRect)
  if (!window || !extended) return undefined
  return { window, extended }
}

/**
 * How much larger the stored rectangle is than the visible one.
 *
 * Returns zero insets when the measurement fails for any reason. A window a few
 * pixels off is a cosmetic problem; refusing to place it at all is not, and
 * this runs on machines the author will never see.
 */
export function measureInsets(hwnd: number): Insets {
  const rects = queryRects(hwnd)
  if (!rects) return NO_INSETS
  const { window, extended } = rects
  return {
    left: extended.left - window.left,
    top: extended.top - window.top,
    right: window.right - extended.right,
    bottom: window.bottom - extended.bottom,
  }
}
