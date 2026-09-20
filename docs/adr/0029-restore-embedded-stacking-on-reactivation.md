# ADR-0029: Restore embedded stacking independently of geometry

Status: Accepted
Date: 2026-09-20

## Evidence

The owner reproduced this sequence in Poke IdleWorld: start a screen, enter the
screen's full/focus mode, click a login input, click another application, return,
then type or press TAB. The cursor could disappear, or remain visible while
clicks stopped working. Passive readings captured hidden cursor samples with
no mouse button held and no capture on either observed GUI thread.

Native sibling-order and hit-test reads found Electron's input HWND above the
embedded browser. A small outer-window resize restored the browser above it;
the same point then hit the browser, and the owner confirmed that cursor and
clicks worked again. This establishes a stacking defect, not the input-queue
topology or the cause of every earlier stuck-capture report.

## Decision

After the panel's activation/focus callback, the shell asks the window adapter
to restore embedded sibling order. The existing private worker gains
`restack <child> <pid> <parent>`. The owner approved this protocol addition after
comparing it with reapplying the existing geometry command.

The adapter supplies only its registered embedded handles. The worker requires
a nonzero matching PID, the expected direct parent, and WS_CHILD. Hidden
children are skipped. SetWindowPos uses HWND_TOP with NOMOVE, NOSIZE,
NOACTIVATE and ASYNCWINDOWPOS: no resize, clipping, reveal, zoom, cursor API,
SetFocus or AttachThreadInput. There is no renderer IPC channel, new dependency,
network access, profile access or added production logging.

## Alternative and consequences

Reapplying the last layout would avoid a new worker verb, but repeats sizing and
clipping solely to repair sibling order. Geometry and stacking have different
invalidation conditions; the core keeps its unchanged-rectangle optimization.
The dedicated command is small and reversible by removing the activation hook,
adapter method and worker verb. FocusChild and its unresolved queue hazard stay
unchanged.

Real-window regression tests cover an actual host input HWND raised above an
embedded Chromium window, unchanged bounds/clip/focus after restoration, hidden
children remaining hidden, and rejected PID/parent mismatches. A composition
guard checks shell wiring. After the updated Hecaton-dev was restarted, the owner
repeated the exact PokeIdle sequence—screen focus mode, login input, another
application, return, then keyboard input—and confirmed that cursor and clicks
continued working. That is the acceptance check for the reported symptom.
