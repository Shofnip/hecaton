# ADR-0028 — Read only the profile's default zoom preference

**Status:** Accepted · **Date:** 2026-09-20

## Context

ADR-0027 requires 100% in focus. Chromium's native reset command returns to the
profile default, which is not necessarily 100%; the default is also inserted
into its preset ladder when it is a custom value. Counting preset commands
without knowing that default can therefore produce the wrong target.

The alternatives were reading the relevant preference or interrogating native
browser menus. This crosses the project's profile-data review boundary; the
owner explicitly approved the restricted read after considering both options.

## Decision

Allow **read-only access to `Default/Preferences` for an app-owned browser
profile**, extracting only `partition.default_zoom_level.x`, the default zoom
level for its normal storage partition. Do not inspect per-host zoom, Cookies,
Login Data, Secure Preferences or Local State. No direct profile writes, file
contents or parser exception text in logs, new IPC path, or configuration field.

The disk adapter bounds the input to 4 MiB and returns only a number or unknown.
An absent key in a valid object means Chromium's default level zero; missing,
unreadable, oversized or malformed files are unknown, not presumed 100%.
`ChromeLauncher.defaultZoomLevel(pid)` resolves only a live profile it owns.

Parsing and the reset-relative command calculation are pure core functions.
The calculation includes custom defaults and compares logarithmic levels with
Chromium's tolerance. It does not infer the current zoom from wheel counts.

## Evidence and limits

The bundled Chromium 156.0.8065.0 was tested against synthetic disposable profiles
with defaults of 125%, 85% and 110.08%. The production reader and pure planner,
followed by native reset/step commands in the probe, reached all 30 requested
targets: repeated 33 1/3%, 100%, 50%, 25%, 100%. The local page independently
reported the actual DPR. The default preference was unchanged. No existing
profile or real-game session was used for this test.

The read is a **persisted default**, not instantaneous feedback of the live
page's zoom. Browser changes not yet flushed, policies overriding preferences,
and another profile partition are not established by this measurement. Automatic
card/focus control is wired into production: unknown defaults skip application
and retry on a later layout, while a successful native reply means commands were
posted rather than independently verifying the live page's resulting percentage.

## Trade-off and rejected alternative

The accepted read protects session files from modification and exposes a bounded
Preferences document to parsing in the app process; only the zoom number escapes.
It is lower-cost and can be removed without migrating data.

Native-menu feedback is more conservative about file access but can interrupt
play with menus and adds UI automation fragility. It was not selected. Reading
or rewriting more of the profile is not authorized by this decision.
