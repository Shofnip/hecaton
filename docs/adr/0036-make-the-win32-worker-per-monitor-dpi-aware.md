# ADR-0036 — Make the Win32 worker Per-Monitor DPI-aware

**Status:** Accepted · **Date:** 2026-09-21

## Context

The renderer measures each card in CSS pixels and deliberately multiplies by the Electron display
scale before sending `screens:layout`. The window-manager contract is therefore physical pixels.
The persistent Win32 worker was a default `powershell.exe`, however, and the real process measured
as `PROCESS_DPI_UNAWARE` (`0`). Windows virtualised its user32 coordinate space and scaled those
already-physical positions again.

This was measured on 2026-09-20 from pixels on two machines at 125% display scaling. A child was
displaced by `position × (scale − 1)` from the parent-client origin, while the same path at 100%
was exact because virtualisation multiplied by one. This is separate from the pre-embed placement
race fixed earlier: it affects every later `SetWindowPos` too.

Microsoft documents that DPI-unaware processes are automatically scaled, while Per-Monitor-aware
processes are not. It requires setting process awareness before DPI-dependent APIs or creating an
HWND.

## Decision

Immediately after compiling the worker's C# surface, and before the worker announces `READY` or
makes any user32 call, set `PROCESS_PER_MONITOR_DPI_AWARE` through
`SetProcessDpiAwareness`. Failure is fatal to worker startup: continuing unaware would silently
corrupt every layout on a scaled display.

The integration suite launches the real persistent `powershell.exe`, opens that process by pid and
reads `PROCESS_DPI_AWARENESS` through `GetProcessDpiAwareness`. The test was red at `0` before the
implementation and is green at `2` after it. The development display remains at 100%, so the
coordinate effect is the already-measured 125% finding above; the new test proves that the real
process has left the virtualization mode that caused it.

## Consequences

The physical rectangles the renderer sends remain physical when the worker calls `SetWindowPos`,
including on mixed-scale monitors. Reads used in the same arithmetic (`GetWindowRect`,
`GetClientRect` and `ClientToScreen`) share that per-monitor coordinate space.

The API is available from Windows 8.1, older than the Windows versions supported by current
Electron, so the worker does not narrow the application's platform support.

The awareness declaration adds bytes to an already constrained encoded PowerShell command. The
existing command-budget test remains unchanged at 3,000 characters of required headroom; the
native entry point is given a short internal alias so the fix fits without weakening that guard.

## Alternatives rejected

- **Divide every coordinate by the current scale.** This would encode Windows virtualisation into
  the adapter, need a different factor per monitor, add rounding, and leave the worker's coordinate
  reads in a different space. It also double-corrects the moment the process becomes aware.
- **Change thread awareness around each user32 operation.** Mixed-mode DPI is useful to a process
  that owns windows with different policies. This worker owns no UI and has one physical-pixel
  contract; per-command scopes would be repetition that a future command could omit.
- **Compile a separate manifested helper executable.** A manifest is Microsoft's preferred place
  for a normal GUI executable, but replacing the existing stdin worker adds a shipped binary,
  build and packaging surface for no behavioral gain here. The real PowerShell process accepts the
  recommended API before it makes any window call.
- **Use Per-Monitor-V2.** It has newer automatic scaling behavior for UI owned by the aware process,
  but this worker creates no HWND, dialog, menu or control. Per-Monitor awareness supplies the same
  unvirtualised physical coordinate contract for its calls against external windows, with an older
  minimum Windows API.
- **Use only system-DPI awareness.** It avoids virtualisation at the system DPI but is the wrong
  contract when a panel moves between monitors with different scales. Per-Monitor awareness follows
  the target monitor instead.

## Sources

- [Microsoft: DPI awareness contexts](https://learn.microsoft.com/en-us/windows/win32/hidpi/dpi-awareness-context)
- [Microsoft: setting the default DPI awareness for a process](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process)
